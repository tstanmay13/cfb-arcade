// Conference grouping for the TEAM_SELECT program picker (UI navigation only —
// not a simulation input). Keyed by school_id; the four Power-4 leagues plus an
// "Others" bucket for independents (Notre Dame). Sourced from the current
// (2026) P4 alignment baked into gm-data.json; kept here as a static map so the
// draft's committed data.json needs no re-bake to group its 68 teams.

export type ConferenceKey = "SEC" | "Big Ten" | "ACC" | "Big 12" | "Others";

/** Tab order for the picker. */
export const CONFERENCE_ORDER: ConferenceKey[] = [
  "SEC",
  "Big Ten",
  "ACC",
  "Big 12",
  "Others",
];

const MEMBERS: Record<ConferenceKey, string[]> = {
  SEC: [
    "alabama", "arkansas", "auburn", "florida", "georgia", "kentucky", "lsu",
    "mississippi_state", "missouri", "oklahoma", "ole_miss", "south_carolina",
    "tennessee", "texas", "texas_a_m", "vanderbilt",
  ],
  "Big Ten": [
    "illinois", "indiana", "iowa", "maryland", "michigan", "michigan_state",
    "minnesota", "nebraska", "northwestern", "ohio_state", "oregon",
    "penn_state", "purdue", "rutgers", "ucla", "usc", "washington", "wisconsin",
  ],
  ACC: [
    "boston_college", "california", "clemson", "duke", "florida_state",
    "georgia_tech", "louisville", "miami", "nc_state", "north_carolina",
    "pittsburgh", "smu", "stanford", "syracuse", "virginia", "virginia_tech",
    "wake_forest",
  ],
  "Big 12": [
    "arizona", "arizona_state", "baylor", "byu", "cincinnati", "colorado",
    "houston", "iowa_state", "kansas", "kansas_state", "oklahoma_state", "tcu",
    "texas_tech", "ucf", "utah", "west_virginia",
  ],
  Others: [
    "notre_dame",
  ],
};

/** school_id → its conference tab. Independents / anything unmapped → "Others". */
export const CONFERENCE_BY_SCHOOL: Record<string, ConferenceKey> = (() => {
  const out: Record<string, ConferenceKey> = {};
  for (const conf of CONFERENCE_ORDER) {
    for (const id of MEMBERS[conf]) out[id] = conf;
  }
  return out;
})();

export function conferenceOf(schoolId: string): ConferenceKey {
  return CONFERENCE_BY_SCHOOL[schoolId] ?? "Others";
}
