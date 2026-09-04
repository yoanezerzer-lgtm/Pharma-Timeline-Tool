/**
 * The set of drugs the pipeline knows how to ingest.
 *
 * Each entry is the minimum a run needs that cannot be discovered
 * automatically: which FDA application to read, and what names to match
 * interventions against in the registry. Everything else is derived.
 */
export interface DrugSpec {
  slug: string;
  brandName: string;
  inn: string;
  modality: string;
  sponsor: string;
  mechanism?: string;
  /**
   * Omit both when the exact number isn't known up front — the common case
   * for a newly approved drug — and the pipeline looks the application up by
   * brand name instead, recovering the real number from openFDA's own
   * response. Set both explicitly when the brand name is ambiguous (shared
   * across unrelated applications) or lookup by name fails.
   */
  applicationNumber?: string;
  applicationType?: 'NDA' | 'BLA' | 'ANDA';
  /** Names to match against ClinicalTrials.gov interventions, including code names. */
  interventionNames: string[];
}

export const DRUG_SPECS: DrugSpec[] = [
  {
    slug: 'upadacitinib',
    brandName: 'Rinvoq',
    inn: 'upadacitinib',
    modality: 'Small molecule',
    sponsor: 'AbbVie Inc.',
    mechanism: 'Selective Janus kinase (JAK1) inhibitor',
    applicationNumber: '211675',
    applicationType: 'NDA',
    // ABT-494 is the development code; early trials are registered under it.
    interventionNames: ['upadacitinib', 'ABT-494', 'Rinvoq'],
  },
  {
    slug: 'rusfertide',
    brandName: 'Mimrylo',
    inn: 'rusfertide',
    modality: 'Peptide (hepcidin mimetic)',
    sponsor: 'Takeda Pharmaceuticals U.S.A., Inc.',
    mechanism: 'Hepcidin mimetic peptide that limits iron availability for red blood cell production',
    // Application number not known up front — approved August 2026, too
    // recent to have looked up the exact NDA number by hand. Left unset so
    // the pipeline resolves it from openFDA's own brand-name search instead.
    // PTG-300 is Protagonist's development code; early trials (including the
    // pivotal Phase 3 VERIFY study, NCT05210790) are registered under it.
    interventionNames: ['rusfertide', 'Mimrylo', 'PTG-300'],
  },
];

/**
 * Case-insensitive on purpose: the workflow dispatch form is free text, and a
 * capitalized drug name ("Upadacitinib") is a natural, easy thing to type
 * that would otherwise fail with "unknown drug" despite being an exact match
 * in every way that matters.
 */
export function getSpec(slug: string): DrugSpec | undefined {
  const needle = slug.toLowerCase();
  return DRUG_SPECS.find((d) => d.slug === needle);
}
