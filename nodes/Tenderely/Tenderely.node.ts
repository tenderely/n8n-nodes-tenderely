import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	collectData,
	flattenRecord,
	getFieldsForCreate,
	getFieldsForUpdate,
	getForms,
	getSearchableFields,
	tenderelyApiRequest,
} from './GenericFunctions';

/** Maximum page size of GET /forms/:id/records. */
const PAGE_MAX = 500;

export class Tenderely implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tenderely',
		name: 'tenderely',
		icon: { light: 'file:tenderely.svg', dark: 'file:tenderely.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create, update and find records in Tenderely BPM forms and complete process steps',
		defaults: { name: 'Tenderely' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'tenderelyApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Record', value: 'record' }],
				default: 'record',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['record'] } },
				options: [
					{
						name: 'Complete Step',
						value: 'completeStep',
						description: "Complete the open step of a record's process",
						action: 'Complete a process step',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a record in a form. If the form has a process, it starts.',
						action: 'Create a record',
					},
					{ name: 'Get', value: 'get', description: 'Get a record by ID', action: 'Get a record' },
					{
						name: 'Get Many',
						value: 'getMany',
						description: 'Get records of a form, optionally filtered by a field value',
						action: 'Get many records',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update fields of a record. Only the fields you fill in are changed.',
						action: 'Update a record',
					},
				],
				default: 'create',
			},
			{
				displayName: 'Form Name or ID',
				name: 'formId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getForms' },
				required: true,
				default: '',
				description:
					'Published form. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Record ID',
				name: 'recordId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { operation: ['get', 'update', 'completeStep'] } },
				description: 'Map the record ID from the Tenderely Trigger or from a Get Many step',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['create'] } },
				description: 'Optional. Defaults to the form name.',
			},
			{
				displayName: 'Fields',
				name: 'columns',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				required: true,
				displayOptions: { show: { operation: ['create'] } },
				typeOptions: {
					loadOptionsDependsOn: ['formId'],
					resourceMapper: {
						resourceMapperMethod: 'getFieldsForCreate',
						mode: 'add',
						fieldWords: { singular: 'field', plural: 'fields' },
						addAllFields: true,
						multiKeyMatch: false,
						supportAutoMap: true,
					},
				},
			},
			{
				displayName: 'Fields',
				name: 'columns',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				required: true,
				displayOptions: { show: { operation: ['update'] } },
				typeOptions: {
					loadOptionsDependsOn: ['formId'],
					resourceMapper: {
						resourceMapperMethod: 'getFieldsForUpdate',
						mode: 'add',
						fieldWords: { singular: 'field', plural: 'fields' },
						addAllFields: false,
						multiKeyMatch: false,
						supportAutoMap: false,
					},
				},
			},
			{
				displayName: 'Options',
				name: 'createOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { operation: ['create'] } },
				options: [
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description:
							'A value unique to this event (for example an order number). If the same key is sent again, Tenderely returns the existing record instead of creating a copy.',
					},
				],
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['getMany'] } },
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { operation: ['getMany'], returnAll: [false] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add filter',
				default: {},
				displayOptions: { show: { operation: ['getMany'] } },
				options: [
					{
						displayName: 'Field Name or ID',
						name: 'fieldKey',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getSearchableFields', loadOptionsDependsOn: ['formId'] },
						default: '',
						description:
							'Field to match (text, e-mail, phone, choice, number and yes/no fields). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Field Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Exact value of the field (case-insensitive for text)',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'multiOptions',
						options: [
							{ name: 'Cancelled', value: 'cancelled' },
							{ name: 'Completed', value: 'completed' },
							{ name: 'Draft', value: 'draft' },
							{ name: 'Rejected', value: 'rejected' },
							{ name: 'Running', value: 'running' },
						],
						default: [],
					},
				],
			},
			{
				displayName: 'Step Key',
				name: 'nodeKey',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['completeStep'] } },
				description: 'Needed only when the record has more than one open step',
			},
			{
				displayName: 'Decision',
				name: 'decision',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['completeStep'] } },
				description: 'The decision of the step, for example "approve" or "reject", if the step has decisions',
			},
			{
				displayName: 'Comment',
				name: 'comment',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				displayOptions: { show: { operation: ['completeStep'] } },
			},
		],
	};

	methods = {
		loadOptions: { getForms, getSearchableFields },
		resourceMapping: { getFieldsForCreate, getFieldsForUpdate },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const formId = String(this.getNodeParameter('formId', i));
				const f = encodeURIComponent(formId);

				if (operation === 'create') {
					const columns = this.getNodeParameter('columns.value', i, {}) as IDataObject;
					const title = this.getNodeParameter('title', i, '') as string;
					const opts = this.getNodeParameter('createOptions', i, {}) as IDataObject;
					const body: IDataObject = { data: collectData(columns) };
					if (title) body.title = title;
					const headers: IDataObject = {};
					if (opts.idempotencyKey) headers['Idempotency-Key'] = String(opts.idempotencyKey);
					const r = await tenderelyApiRequest.call(this, 'POST', `/forms/${f}/records`, { body, headers });
					const form = (r.body.form || {}) as IDataObject;
					out.push({
						json: flattenRecord({ ...((r.body.instance || {}) as IDataObject), formId }, form.name as string),
						pairedItem: { item: i },
					});
				} else if (operation === 'update') {
					const recordId = String(this.getNodeParameter('recordId', i));
					const columns = this.getNodeParameter('columns.value', i, {}) as IDataObject;
					const data = collectData(columns);
					if (!Object.keys(data).length) {
						throw new NodeOperationError(this.getNode(), 'Fill in at least one field to update.', { itemIndex: i });
					}
					const r = await tenderelyApiRequest.call(this, 'PATCH', `/forms/${f}/records/${encodeURIComponent(recordId)}`, {
						body: { data },
					});
					const rec = (r.body.record || r.body.instance || { _id: recordId }) as IDataObject;
					const form = (r.body.form || {}) as IDataObject;
					out.push({ json: flattenRecord({ ...rec, formId }, form.name as string), pairedItem: { item: i } });
				} else if (operation === 'get') {
					const recordId = String(this.getNodeParameter('recordId', i));
					const r = await tenderelyApiRequest.call(this, 'GET', `/forms/${f}/records/${encodeURIComponent(recordId)}`);
					const form = (r.body.form || {}) as IDataObject;
					out.push({
						json: flattenRecord({ ...((r.body.record || {}) as IDataObject), formId }, form.name as string),
						pairedItem: { item: i },
					});
				} else if (operation === 'getMany') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const qs: IDataObject = {};
					if (filters.fieldKey && filters.value !== undefined && filters.value !== '') {
						qs[`field[${filters.fieldKey}]`] = filters.value;
					} else if (filters.fieldKey || filters.value) {
						throw new NodeOperationError(this.getNode(), 'Fill in both "Field" and "Field Value", or neither.', {
							itemIndex: i,
						});
					}
					if (Array.isArray(filters.status) && filters.status.length) qs.status = filters.status.join(',');

					// Cursor paging: `after` is the ID of the last record seen.
					let after: string | null = null;
					let got = 0;
					do {
						const page: number = Math.min(PAGE_MAX, limit - got);
						const r: { body: IDataObject } = await tenderelyApiRequest.call(this, 'GET', `/forms/${f}/records`, {
							qs: { ...qs, limit: page, ...(after ? { after } : {}) },
						});
						const form = (r.body.form || {}) as IDataObject;
						const records = (r.body.records || []) as IDataObject[];
						for (const rec of records) {
							out.push({ json: flattenRecord({ ...rec, formId }, form.name as string), pairedItem: { item: i } });
						}
						got += records.length;
						after = ((r.body.paging || {}) as IDataObject).nextAfter as string | null;
					} while (after && got < limit);
				} else if (operation === 'completeStep') {
					const recordId = String(this.getNodeParameter('recordId', i));
					const body: IDataObject = {};
					const nodeKey = this.getNodeParameter('nodeKey', i, '') as string;
					const decision = this.getNodeParameter('decision', i, '') as string;
					const comment = this.getNodeParameter('comment', i, '') as string;
					if (nodeKey) body.nodeKey = nodeKey;
					if (decision) body.action = decision;
					if (comment) body.comment = comment;
					const r = await tenderelyApiRequest.call(
						this,
						'POST',
						`/forms/${f}/records/${encodeURIComponent(recordId)}/advance`,
						{ body },
					);
					out.push({
						json: {
							id: recordId,
							status: r.body.status || '',
							current_steps: (r.body.currentNodeKeys as string[]) || [],
						},
						pairedItem: { item: i },
					});
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// NodeOperationError returns an existing NodeOperationError unchanged and keeps the
				// message and description of a NodeApiError.
				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
					description: (error as { description?: string }).description,
				});
			}
		}
		return [out];
	}
}
