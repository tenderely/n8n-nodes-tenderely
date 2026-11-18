import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	IWebhookFunctions,
	JsonObject,
	ResourceMapperField,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Shared helpers: API requests, error messages, record output shape and form schema.
 *
 * The output shape and error messages match Tenderely's other automation integrations,
 * so users moving between platforms see the same field names and explanations.
 */

type Ctx = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

export const APP_URL = 'https://app.tenderely.com';

/**
 * Readable text for Tenderely error codes. Unknown codes are shown as-is: a generic
 * "something went wrong" would only send the user to support.
 */
const ERROR_TEXT: Record<string, string> = {
	API_KEY_REQUIRED: 'API key is missing.',
	API_KEY_INVALID:
		'The API key is invalid or has been revoked. Create a new one in Tenderely: BPM → Integrations → API keys.',
	RATE_LIMITED:
		"Too many requests for this API key. Try again in a minute, or raise the key's per-minute limit in Tenderely.",
	WRITE_NOT_ALLOWED:
		'This API key is read-only. Enable "Allow writing" for the key in Tenderely: BPM → Integrations → API keys.',
	FORM_OUT_OF_SCOPE: "This API key is limited to other forms. Add this form to the key's scope in Tenderely.",
	SENSITIVE_FORM_NOT_ALLOWED:
		'This form holds sensitive data. Allow sensitive forms for this API key in Tenderely to use it.',
	FORM_NOT_PUBLISHED: 'The form is not published yet. Publish it in Tenderely first.',
	NOT_FOUND: 'Record or form not found.',
	FORM_REQUIRED: 'Choose a form.',
	HOOK_LIMIT_REACHED:
		'This API key has too many active triggers (100). Deactivate some workflows or use a separate key.',
	FIELD_FILTER_INVALID: 'This field cannot be searched (it may be hidden from this API key).',
	FIELD_FILTER_UNSUPPORTED: 'Searching is supported for text, e-mail, phone, choice, number and yes/no fields.',
	NO_OPEN_STEP: 'The record has no open step to complete.',
	NOT_RUNNING: "The record's process is not running.",
	STEP_NOT_FOUND: 'No open step with this key.',
	DUPLICATE_VALUE: 'Another record already has this value in a unique field.',
	VALIDATION_FAILED: 'Some values are not valid for this form.',
	FORM_INVALID: 'Some required fields are missing or have invalid values.',
	FIELD_NOT_WRITABLE:
		'This API key is not allowed to write some of these fields (the form restricts them). Remove them from the node, or turn on "Include restricted fields" for the key in Tenderely.',
	KEY_HAS_NO_OWNER: 'The API key has no owner user. Create a new key in Tenderely.',
	EVENT_INVALID: 'Unknown event.',
	// Tenderely only delivers to public https addresses on port 443 (SSRF protection).
	URL_SCHEME_NOT_ALLOWED:
		"Tenderely can only call public https webhook addresses. Set n8n's WEBHOOK_URL to your public https address.",
	URL_PORT_NOT_ALLOWED:
		"Tenderely can only call webhook addresses on the standard https port (443). Put n8n behind a reverse proxy and set WEBHOOK_URL (for example https://n8n.example.com/).",
	SSRF_BLOCKED_ADDRESS:
		"n8n's webhook address points to a private network, which Tenderely cannot reach. Set WEBHOOK_URL to a public address.",
	URL_INVALID: "n8n's webhook address is not a valid URL.",
	URL_CREDENTIALS_NOT_ALLOWED: 'The webhook address must not contain a user name or password.',
};

export function errorText(code: string | undefined, body: IDataObject | undefined): string {
	const base = (code && ERROR_TEXT[code]) || `Tenderely returned ${code || 'an error'}.`;
	let detail = '';
	if (body) {
		if (typeof body.message === 'string') detail = body.message;
		else if (Array.isArray(body.errors))
			detail = (body.errors as IDataObject[])
				.map((e) => (typeof e === 'object' && e ? e.message || e.field : e))
				.join('; ');
		else if (Array.isArray(body.fields) && body.fields.length) detail = `fields: ${body.fields.join(', ')}`;
	}
	return detail ? `${base} (${String(detail).slice(0, 300)})` : base;
}

export async function baseUrl(this: Ctx): Promise<string> {
	const c = await this.getCredentials('tenderelyApi');
	return String(c.baseUrl || 'https://appbackend.tenderely.com').replace(/\/$/, '');
}

export interface ApiOptions {
	body?: IDataObject;
	qs?: IDataObject;
	headers?: IDataObject;
	/** Status codes that are not treated as errors; the caller checks `statusCode` (for example 404). */
	allowStatus?: number[];
}

/**
 * Request to the Tenderely API. The status code is checked here (`ignoreHttpStatusErrors`)
 * so the server's `code` field is always turned into a readable message, independent of
 * how the request helper shapes its own errors.
 */
export async function tenderelyApiRequest(
	this: Ctx,
	method: IHttpRequestMethods,
	path: string,
	opts: ApiOptions = {},
): Promise<{ statusCode: number; body: IDataObject }> {
	const url = `${await baseUrl.call(this)}/bpm/api/v1${path}`;
	const options: IHttpRequestOptions = {
		method,
		url,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		headers: { 'user-agent': 'n8n-nodes-tenderely', ...(opts.headers || {}) },
	};
	if (opts.body) options.body = opts.body;
	if (opts.qs) options.qs = opts.qs;

	const res = (await this.helpers.httpRequestWithAuthentication.call(this, 'tenderelyApi', options)) as {
		statusCode: number;
		body: IDataObject | string;
	};
	let body: IDataObject = {};
	if (res.body && typeof res.body === 'object') body = res.body;
	else if (typeof res.body === 'string' && res.body) {
		try {
			body = JSON.parse(res.body);
		} catch {
			body = { message: res.body.slice(0, 300) };
		}
	}
	if (res.statusCode >= 400 && !(opts.allowStatus || []).includes(res.statusCode)) {
		const code = typeof body.code === 'string' ? body.code : `HTTP_${res.statusCode}`;
		throw new NodeApiError(this.getNode(), body as JsonObject, {
			message: errorText(code, body),
			httpCode: String(res.statusCode),
			description: `Tenderely error code: ${code}`,
		});
	}
	return { statusCode: res.statusCode, body };
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/**
 * One record shape for the trigger and every operation, so expressions keep working when
 * they are moved from one node to another.
 */
export function flattenRecord(rec: IDataObject, formName?: string): IDataObject {
	const id = String(rec.id || rec._id || '');
	return {
		id,
		title: rec.title || '',
		status: rec.status || '',
		form_id: rec.formId ? String(rec.formId) : rec.form_id || null,
		form_name: rec.formName || formName || '',
		created_at: iso(rec.createdAt),
		updated_at: iso(rec.updatedAt),
		completed_at: iso(rec.completedAt),
		current_steps: Array.isArray(rec.currentNodeKeys) ? (rec.currentNodeKeys as string[]) : [],
		url: rec.url || (id ? `${APP_URL}/#/bpm/instance/${id}` : ''),
		fields: rec.data || {},
	};
}

export const label = (l: unknown): string => {
	if (l && typeof l === 'object') {
		const o = l as Record<string, string>;
		return o.en || o.tr || Object.values(o)[0] || '';
	}
	return String(l || '');
};

interface SchemaField {
	key: string;
	label: unknown;
	inputType?: string;
	required?: boolean;
	searchable?: boolean;
	options?: Array<{ value: unknown; label: unknown }>;
}

export async function getFormSchema(this: Ctx, formId: string): Promise<{ name: string; fields: SchemaField[] }> {
	const r = await tenderelyApiRequest.call(this, 'GET', `/forms/${encodeURIComponent(formId)}`);
	const form = (r.body.form || {}) as IDataObject;
	return { name: String(form.name || ''), fields: (form.fields || []) as SchemaField[] };
}

/* ── loadOptions / resourceMapper ── */

export async function getForms(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const r = await tenderelyApiRequest.call(this, 'GET', '/forms');
	return ((r.body.forms || []) as IDataObject[]).map((f) => ({ name: String(f.name), value: String(f._id) }));
}

export async function getSearchableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const formId = this.getCurrentNodeParameter('formId') as string;
	if (!formId) return [];
	const f = await getFormSchema.call(this, formId);
	// Tenderely decides which fields can be searched.
	return f.fields.filter((x) => x.searchable).map((x) => ({ name: label(x.label) || x.key, value: x.key }));
}

/**
 * Tenderely `inputType` → n8n field type. Tenderely decides which fields are writable:
 * fields without an `inputType` (calculated, auto-number, file) are not listed at all.
 */
const FIELD_TYPE: Record<string, ResourceMapperField['type']> = {
	text: 'string',
	email: 'string',
	url: 'string',
	longtext: 'string',
	number: 'number',
	boolean: 'boolean',
	date: 'dateTime',
	select: 'options',
	multiselect: 'array',
};

async function mapperFields(this: ILoadOptionsFunctions, allOptional: boolean) {
	const formId = this.getNodeParameter('formId', 0) as string;
	if (!formId) return { fields: [] };
	const f = await getFormSchema.call(this, formId);
	const fields: ResourceMapperField[] = f.fields
		.filter((x) => x.inputType)
		.map((x) => {
			const field: ResourceMapperField = {
				id: x.key,
				displayName: label(x.label) || x.key,
				required: allOptional ? false : !!x.required,
				defaultMatch: false,
				display: true,
				type: FIELD_TYPE[x.inputType as string] || 'string',
				canBeUsedToMatch: false,
			};
			if (x.inputType === 'select' && (x.options || []).length) {
				field.options = (x.options || []).map((o) => ({
					name: label(o.label) || String(o.value),
					value: String(o.value),
				}));
			}
			return field;
		});
	return { fields };
}

export async function getFieldsForCreate(this: ILoadOptionsFunctions) {
	return mapperFields.call(this, false);
}

/** Nothing is required on update: only the fields that are filled in are written. */
export async function getFieldsForUpdate(this: ILoadOptionsFunctions) {
	return mapperFields.call(this, true);
}

/** Builds the record `data` object from the resource mapper value; empty values are skipped. */
export function collectData(value: IDataObject | null | undefined): IDataObject {
	const data: IDataObject = {};
	for (const [k, v] of Object.entries(value || {})) {
		if (v === undefined || v === null || v === '') continue;
		data[k] = v;
	}
	return data;
}
