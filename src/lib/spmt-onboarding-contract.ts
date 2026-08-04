export const SPMT_ONBOARDING_CUSTOM_ID = 'spmt_join_recover';
export const SPMT_ONBOARDING_LABEL = 'Join or Recover SPMT with Twitch';

export function buildSpmtOnboardingButton() {
  return {
    type: 2,
    style: 3,
    label: SPMT_ONBOARDING_LABEL,
    custom_id: SPMT_ONBOARDING_CUSTOM_ID,
    emoji: { name: '🚀' },
  };
}
