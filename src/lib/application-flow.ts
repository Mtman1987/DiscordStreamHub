export type ApplicationType = 'mod' | 'partner' | 'dev';

export const APPLICATION_FLOW_VERSION = '2.0';
export const APPLICATION_SUPPORT_FOOTER = 'You can ask Athena or Mika in this DM any questions and they will answer.';
export const SPMT_DOCS_URL = 'https://spmt.live/docs.html';

export type ApplicationDefinition = {
  type: ApplicationType;
  name: string;
  inquiryLabel: string;
  emoji: string;
  summary: string;
  responsibilities: string;
  perks: string;
  termsTitle: string;
  termsUrl: string;
  termsHash: string;
  questions: Array<{ id: string; label: string; placeholder: string; style?: 1 | 2 }>;
};

export const APPLICATION_DEFINITIONS: Record<ApplicationType, ApplicationDefinition> = {
  mod: {
    type: 'mod', name: 'Moderation', inquiryLabel: 'Inquire about Moderation', emoji: '🛡️',
    summary: 'Help keep SPMT welcoming, fair, safe, and well documented across community surfaces.',
    responsibilities: 'Apply published rules consistently; document incidents; protect private information; escalate disputes through the crew hierarchy; never promise an outcome you do not control.',
    perks: 'Crew access, direct coordination with SPMT leadership, early operational context, and recognition for reliable community service.',
    termsTitle: 'Crew & Administrator Community Terms',
    termsUrl: 'https://spmt.live/docs/legal/CREW_ADMINISTRATOR_COMMUNITY_TERMS.md',
    termsHash: '4db67a70319b8a8b3a2315fcc63fc82ad4b8f075c9332aea29b75f9c856622cb',
    questions: [
      { id: 'experience', label: 'Relevant moderation experience', placeholder: 'Communities, responsibilities, and lessons learned', style: 2 },
      { id: 'availability', label: 'Availability and timezone', placeholder: 'Timezone and realistic weekly availability', style: 2 },
      { id: 'judgment', label: 'How would you handle a dispute?', placeholder: 'Evidence, de-escalation, privacy, and escalation', style: 2 },
      { id: 'safety', label: 'How do you protect user data?', placeholder: 'Confidentiality, least access, and safe documentation', style: 2 },
      { id: 'motivation', label: 'Why SPMT moderation?', placeholder: 'Why this ecosystem and what you hope to contribute', style: 2 },
    ],
  },
  partner: {
    type: 'partner', name: 'Partnership', inquiryLabel: 'Inquire about Partnership', emoji: '🤝',
    summary: 'Coordinate a transparent, non-exclusive community or product relationship with SPMT.',
    responsibilities: 'Represent capabilities honestly; protect shared data; follow brand and safety rules; maintain a reliable contact; disclose conflicts and security incidents promptly.',
    perks: 'Partner coordination spaces, cross-community opportunities, documented integration paths, and access to approved ecosystem resources.',
    termsTitle: 'Partner Community Terms',
    termsUrl: 'https://spmt.live/docs/legal/PARTNER_COMMUNITY_TERMS.md',
    termsHash: '4dc16712071c6521a239324065e8a09a4717594056ffe3291e21cd41c946ebd0',
    questions: [
      { id: 'entity', label: 'Entity, community, and links', placeholder: 'Name, ownership, primary URL, and contact', style: 2 },
      { id: 'proposal', label: 'What partnership do you propose?', placeholder: 'Scope, users served, and mutual value', style: 2 },
      { id: 'operations', label: 'How will you operate it?', placeholder: 'Contacts, support, moderation, and availability', style: 2 },
      { id: 'data', label: 'What data or access is needed?', placeholder: 'Minimum scopes, retention, security, and revocation', style: 2 },
      { id: 'success', label: 'What does success look like?', placeholder: 'Measurable outcomes, risks, and exit plan', style: 2 },
    ],
  },
  dev: {
    type: 'dev', name: 'Development', inquiryLabel: 'Inquire about Development', emoji: '🧩',
    summary: 'Build or integrate software through SPMT’s documented SDK, identity, event, and support contracts.',
    responsibilities: 'Use least privilege; protect credentials and user data; test tenant boundaries; report vulnerabilities privately; maintain compatibility and support ownership.',
    perks: 'SDK and integration guidance, developer coordination, documented scopes and events, and eligibility for approved ecosystem listings.',
    termsTitle: 'Developer & SDK Community Terms',
    termsUrl: 'https://spmt.live/docs/legal/DEVELOPER_SDK_COMMUNITY_TERMS.md',
    termsHash: '5b2076d29d214a0ec3399cf81ee04cd3f516a4359e0d0970da67a834f5c04dd5',
    questions: [
      { id: 'project', label: 'Project and source overview', placeholder: 'Purpose, ownership, repository, and users', style: 2 },
      { id: 'integration', label: 'Requested SPMT integration', placeholder: 'OAuth, SDK, events, APIs, or other surfaces', style: 2 },
      { id: 'security', label: 'Security and data plan', placeholder: 'Scopes, secrets, retention, isolation, and incident response', style: 2 },
      { id: 'testing', label: 'Testing and deployment plan', placeholder: 'CI, staging, rollback, monitoring, and support', style: 2 },
      { id: 'maintenance', label: 'Long-term maintenance owner', placeholder: 'Responsible people, availability, and deprecation plan', style: 2 },
    ],
  },
};

export function parseApplicationType(value: string | null | undefined): ApplicationType | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (['mod', 'md', 'moderator', 'moderation', 'modship'].includes(normalized)) return 'mod';
  if (['partner', 'partnership'].includes(normalized)) return 'partner';
  if (['dev', 'developer', 'development', 'sdk'].includes(normalized)) return 'dev';
  return null;
}

export function buildApplicationModal(type: ApplicationType, serverId: string) {
  const definition = APPLICATION_DEFINITIONS[type];
  return {
    custom_id: `application_submit:${type}:${serverId}`,
    title: `${definition.name} Application`.slice(0, 45),
    components: definition.questions.map(question => ({
      type: 1,
      components: [{
        type: 4,
        custom_id: question.id,
        label: question.label.slice(0, 45),
        style: question.style || 2,
        required: true,
        min_length: 10,
        max_length: 1000,
        placeholder: question.placeholder.slice(0, 100),
      }],
    })),
  };
}

export function buildInquiryMessage(type: ApplicationType, serverId: string, serverName = 'SPMT') {
  const definition = APPLICATION_DEFINITIONS[type];
  return {
    embeds: [{
      title: `${definition.emoji} ${serverName} ${definition.name} Inquiry`,
      description: definition.summary,
      color: 0x6d5dfc,
      fields: [
        { name: 'Responsibilities', value: definition.responsibilities },
        { name: 'Perks', value: definition.perks },
        { name: 'Before applying', value: `Read the role terms and ecosystem documentation. Participation is subject to owner approval and later explicit electronic acceptance.` },
      ],
      footer: { text: APPLICATION_SUPPORT_FOOTER },
      timestamp: new Date().toISOString(),
    }],
    components: [
      { type: 1, components: [{ type: 2, style: 1, label: `Start ${definition.name} Application`.slice(0, 80), custom_id: `application_start:${type}:${serverId}` }] },
      { type: 1, components: [
        { type: 2, style: 5, label: 'Read Terms', url: definition.termsUrl },
        { type: 2, style: 5, label: 'SPMT Documentation', url: SPMT_DOCS_URL },
      ] },
    ],
  };
}

export function publicApplicationEmbed(serverId: string) {
  return {
    embeds: [{
      title: '🚀 Explore Ways to Participate in SPMT',
      description: 'Start with an inquiry. We will DM the responsibilities, perks, terms, and application link before asking you to apply.',
      color: 0x6d5dfc,
      fields: Object.values(APPLICATION_DEFINITIONS).map(item => ({ name: `${item.emoji} ${item.name}`, value: item.summary, inline: false })),
      footer: { text: 'SPMT • Owner-owned and operated ecosystem • Learn first, then apply' },
      timestamp: new Date().toISOString(),
    }],
    components: [{
      type: 1,
      components: Object.values(APPLICATION_DEFINITIONS).map(item => ({
        type: 2, style: item.type === 'partner' ? 3 : 1, label: item.inquiryLabel, custom_id: `application_inquiry:${item.type}:${serverId}`,
      })),
    }],
  };
}
