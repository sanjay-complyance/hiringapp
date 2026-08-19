export type HrScreenRecord = {
  consent_status: unknown;
  availability_date: unknown;
  notice_period_days: unknown;
  work_mode_preference: unknown;
  expected_compensation: unknown;
  screening_suitability: unknown;
  role_interest: unknown;
  location_confirmed: unknown;
};

export function missingHrScreenFields(record: HrScreenRecord) {
  const required: Array<[keyof HrScreenRecord, string]> = [
    ["consent_status", "consent"],
    ["availability_date", "availability"],
    ["notice_period_days", "notice period"],
    ["work_mode_preference", "work mode preference"],
    ["expected_compensation", "expected compensation"],
    ["screening_suitability", "company and role suitability"],
    ["role_interest", "role interest"],
    ["location_confirmed", "location confirmation"]
  ];
  return required.filter(([key]) => {
    const value = record[key];
    if (key === "consent_status") return value === null || value === undefined || value === "unknown";
    return value === null || value === undefined || value === "";
  }).map(([, label]) => label);
}
