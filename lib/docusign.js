// lib/docusign.js
// Auto-execute rights transfer agreement on auction close

const docusign = require('docusign-esign');
require('dotenv').config();

async function getApiClient() {
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath('https://na4.docusign.net/restapi');

  const privateKey = process.env.DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, '\n');
  const tokenResp = await apiClient.requestJWTUserToken(
    process.env.DOCUSIGN_INTEGRATION_KEY,
    process.env.DOCUSIGN_USER_ID,
    ['signature', 'impersonation'],
    Buffer.from(privateKey),
    3600
  );
  apiClient.addDefaultHeader('Authorization', `Bearer ${tokenResp.body.access_token}`);
  return apiClient;
}

// ── Execute rights transfer agreement ────────────────────────
async function executeRightsTransfer({
  transactionId, buyerEmail, buyerName,
  photographerEmail, photographerName,
  listingTitle, salePrice, exclusiveTier
}) {
  const apiClient   = await getApiClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const exclusivityText = {
    'full_exclusive':     'FULL EXCLUSIVE — Buyer holds all reproduction, distribution, and sublicensing rights. Photographer may not post, license, or distribute the content in any form.',
    'platform_exclusive': 'PLATFORM EXCLUSIVE — Buyer holds exclusive rights for digital platform distribution. Photographer may not post to any social media or digital channel.',
    'non_exclusive':      'NON-EXCLUSIVE — Buyer holds rights to publish and distribute. Photographer retains the right to post organically on their own channels.'
  }[exclusiveTier] || exclusiveTier;

  const envelopeDefinition = new docusign.EnvelopeDefinition();
  envelopeDefinition.templateId = process.env.DOCUSIGN_TEMPLATE_ID;
  envelopeDefinition.status     = 'sent';

  // Template roles must match your DocuSign template role names
  envelopeDefinition.templateRoles = [
    {
      roleName:  'Buyer',
      name:      buyerName,
      email:     buyerEmail,
      tabs: {
        textTabs: [
          { tabLabel: 'listing_title',     value: listingTitle },
          { tabLabel: 'sale_price',        value: `$${salePrice.toLocaleString()}` },
          { tabLabel: 'exclusivity_terms', value: exclusivityText },
          { tabLabel: 'transaction_id',    value: transactionId },
          { tabLabel: 'execution_date',    value: new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) }
        ]
      }
    },
    {
      roleName: 'Photographer',
      name:     photographerName || 'Photographer',
      email:    photographerEmail
    }
  ];

  envelopeDefinition.emailSubject = `Rights Transfer Agreement: "${listingTitle}"`;
  envelopeDefinition.emailBlurb   = `Your Rocket Ranch Media Marketplace rights transfer for "${listingTitle}" is ready to sign.`;

  const result = await envelopesApi.createEnvelope(
    process.env.DOCUSIGN_ACCOUNT_ID,
    { envelopeDefinition }
  );

  return { envelopeId: result.envelopeId, status: result.status };
}

// ── Check envelope signing status ────────────────────────────
async function checkEnvelopeStatus(envelopeId) {
  const apiClient   = await getApiClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);
  const envelope = await envelopesApi.getEnvelope(process.env.DOCUSIGN_ACCOUNT_ID, envelopeId);
  return { status: envelope.status, completedAt: envelope.completedDateTime };
}

module.exports = { executeRightsTransfer, checkEnvelopeStatus };
