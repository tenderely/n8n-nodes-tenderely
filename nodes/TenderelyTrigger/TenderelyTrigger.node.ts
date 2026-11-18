import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { flattenRecord, getForms, tenderelyApiRequest } from '../Tenderely/GenericFunctions';

/** Accepted clock difference in seconds; Tenderely signs every delivery with `t=<unix>`. */
const SIGNATURE_TOLERANCE_SEC = 300;

/**
 * Verifies `X-Tenderely-Signature: t=<unix>,v1=<hex>`, where v1 = HMAC-SHA256(secret,
 * `${t}.${rawBody}`). The signature is checked against the RAW body: a parsed and
 * re-serialized body is a different string.
 */
export function verifySignature(
	secret: string,
	header: string | undefined,
	rawBody: Buffer | string,
	nowSec = Math.floor(Date.now() / 1000),
): boolean {
	if (!secret || !header) return false;
	const parts: Record<string, string> = {};
	for (const p of String(header).split(',')) {
		const idx = p.indexOf('=');
		if (idx > 0) parts[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
	}
	const t = Number(parts.t);
	if (!Number.isFinite(t) || !parts.v1) return false;
	if (Math.abs(nowSec - t) > SIGNATURE_TOLERANCE_SEC) return false;
	const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
	const a = Buffer.from(expected, 'hex');
	const b = Buffer.from(parts.v1, 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}

export class TenderelyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tenderely Trigger',
		name: 'tenderelyTrigger',
		icon: { light: 'file:tenderely.svg', dark: 'file:tenderely.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow instantly when a record in a Tenderely BPM form is created, updated or completed',
		defaults: { name: 'Tenderely Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'tenderelyApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				required: true,
				default: 'record.created',
				options: [
					{ name: 'Record Completed', value: 'record.completed', description: "A record's process is completed" },
					{ name: 'Record Created', value: 'record.created', description: 'A record is created in the form' },
					{ name: 'Record Deleted', value: 'record.deleted', description: 'A record is deleted from the form' },
					{ name: 'Record Updated', value: 'record.updated', description: 'A record in the form is updated' },
				],
			},
			{
				displayName: 'Form Name or ID',
				name: 'formId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getForms' },
				required: true,
				default: '',
				description:
					'Published form to watch. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	};

	methods = { loadOptions: { getForms } };

	/**
	 * REST hook: subscribe with `POST /hooks` on activation, unsubscribe with `DELETE /hooks/:id`.
	 * The subscription always uses the API key's current permissions in Tenderely.
	 */
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (!staticData.hookId) return false;
				const r = await tenderelyApiRequest.call(this, 'GET', `/hooks/${encodeURIComponent(String(staticData.hookId))}`, {
					allowStatus: [404],
				});
				const b = r.body;
				// A subscription that was deleted or disabled in Tenderely, or no longer matches the
				// node settings, counts as missing; otherwise the workflow would look active but
				// never receive events.
				const ok =
					r.statusCode === 200 &&
					b.isActive === true &&
					b.url === this.getNodeWebhookUrl('default') &&
					b.event === this.getNodeParameter('event') &&
					b.formId === String(this.getNodeParameter('formId'));
				if (!ok) {
					if (r.statusCode === 200) {
						await tenderelyApiRequest.call(this, 'DELETE', `/hooks/${encodeURIComponent(String(staticData.hookId))}`, {
							allowStatus: [404],
						});
					}
					delete staticData.hookId;
					delete staticData.secret;
				}
				return ok;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const r = await tenderelyApiRequest.call(this, 'POST', '/hooks', {
					body: {
						targetUrl: this.getNodeWebhookUrl('default'),
						event: this.getNodeParameter('event') as string,
						formId: String(this.getNodeParameter('formId')),
						source: 'n8n',
					},
				});
				if (!r.body.id) return false;
				staticData.hookId = String(r.body.id);
				staticData.secret = String(r.body.secret || '');
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (staticData.hookId) {
					// 404 = already deleted (for example in Tenderely); deactivation continues.
					await tenderelyApiRequest.call(this, 'DELETE', `/hooks/${encodeURIComponent(String(staticData.hookId))}`, {
						allowStatus: [404],
					});
				}
				delete staticData.hookId;
				delete staticData.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const staticData = this.getWorkflowStaticData('node');
		const secret = String(staticData.secret || '');
		const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
		const header = this.getHeaderData()['x-tenderely-signature'] as string | undefined;

		// Unsigned or wrongly signed requests never start the workflow, even if the webhook
		// address is known. The 401 is visible in Tenderely's delivery log.
		if (!raw || !verifySignature(secret, header, raw)) {
			const res = this.getResponseObject();
			res.status(401).json({ ok: false, code: 'SIGNATURE_INVALID' });
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData() as IDataObject;
		const record = (body.record || {}) as IDataObject;
		return {
			workflowData: [
				[
					{
						json: {
							...flattenRecord(record),
							event: body.event || this.getHeaderData()['x-tenderely-event'] || '',
							occurred_at: body.occurredAt || null,
						},
					},
				],
			],
		};
	}
}
