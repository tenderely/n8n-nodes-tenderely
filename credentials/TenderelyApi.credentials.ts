import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Tenderely API key (BPM → Integrations → API keys), sent in the `x-api-key` header.
 * The connection test calls `GET /bpm/api/v1/me`, which returns the company and key name.
 */
export class TenderelyApi implements ICredentialType {
	name = 'tenderelyApi';

	displayName = 'Tenderely API';

	icon: Icon = { light: 'file:tenderely.svg', dark: 'file:tenderely.dark.svg' };

	documentationUrl = 'https://tenderely.com/developers/#n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create a key in Tenderely: BPM → Integrations → API keys. Turn on "Allow writing" if your workflows will create or update records. The key is shown only once.',
		},
		{
			// Production address; only changed for a test environment.
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://appbackend.tenderely.com',
			description: 'Leave as is unless Tenderely support gave you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/$/, "")}}',
			url: '/bpm/api/v1/me',
		},
	};
}
