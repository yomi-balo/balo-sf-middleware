import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sfForwardQueue } from '../queue/client.js';

const SF_VERSION = process.env.SF_API_VERSION || 'v65.0';

interface UpsertRouteConfig {
  path: string;
  route: string;          // human-readable label stored in job
  sobject: string;
  externalIdField: string;
}

const UPSERT_ROUTES: UpsertRouteConfig[] = [
  {
    path: '/crm/lead/:id',
    route: 'PATCH /crm/lead/:id',
    sobject: 'Lead',
    externalIdField: 'Balo_Id__c',
  },
  {
    path: '/crm/account/:id',
    route: 'PATCH /crm/account/:id',
    sobject: 'Account',
    externalIdField: 'Balo_Id__c',
  },
  {
    path: '/crm/contact/:id',
    route: 'PATCH /crm/contact/:id',
    sobject: 'Contact',
    externalIdField: 'Balo_Id__c',
  },
  {
    path: '/crm/opportunity/case/:id',
    route: 'PATCH /crm/opportunity/case/:id',
    sobject: 'Opportunity',
    externalIdField: 'Balo_Case_Number__c',
  },
  {
    path: '/crm/opportunity/project/:id',
    route: 'PATCH /crm/opportunity/project/:id',
    sobject: 'Opportunity',
    externalIdField: 'Balo_Id__c',
  },
  {
    path: '/crm/project-expert/:id',
    route: 'PATCH /crm/project-expert/:id',
    sobject: 'Project__c',
    externalIdField: 'Balo_Id__c',
  },
  {
    path: '/crm/consultation/:id',
    route: 'PATCH /crm/consultation/:id',
    sobject: 'Consultation__c',
    externalIdField: 'Balo_Id__c',
  },
];

export default async function upsertRoutes(fastify: FastifyInstance): Promise<void> {
  for (const cfg of UPSERT_ROUTES) {
    fastify.patch(
      cfg.path,
      async (
        request: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>,
        reply,
      ) => {
        const id = encodeURIComponent(request.params.id);
        const sfPath = `/services/data/${SF_VERSION}/sobjects/${cfg.sobject}/${cfg.externalIdField}/${id}`;

        const job = await sfForwardQueue.add('sf-forward', {
          route: cfg.route,
          sfMethod: 'PATCH',
          sfPath,
          body: request.body,
          enqueuedAt: new Date().toISOString(),
        });

        reply.code(202).send({ accepted: true, jobId: job.id });
      },
    );
  }
}
