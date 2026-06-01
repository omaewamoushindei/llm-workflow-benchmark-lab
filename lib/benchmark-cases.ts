import type { ClinicalCase, ReferenceRecommendation } from './types'

export type BenchmarkCaseSourceType =
  | 'thermo_case_adapted'
  | 'synthetic_algorithm_case'

export interface BenchmarkCase {
  id: string
  title: string
  sourceType: BenchmarkCaseSourceType
  description: string
  caseData: ClinicalCase
  expectedReferenceLabel: ReferenceRecommendation
  tags: string[]
  sourceNote: string
  limitations: string[]
}

function createCase(overrides: Partial<ClinicalCase>): ClinicalCase {
  return {
    patientAge: null,
    sex: '',
    symptoms: '',
    infectionContext: 'other_or_unclear',
    clinicalImprovement: 'unclear',
    currentAntibioticStatus: 'empirical',
    antibioticsDurationDays: null,
    peakPct: null,
    currentPct: null,
    wbc: null,
    crp: null,
    exclusionCondition: 'none',
    clinicalNotes: '',
    caseDescription: '',
    ...overrides,
  }
}

export const benchmarkCases: BenchmarkCase[] = [
  {
    id: 'thermo-sepsis-safe-discontinuation',
    title: 'Sepsis safe antibiotic discontinuation',
    sourceType: 'thermo_case_adapted',
    description:
      'Severe sepsis ICU case with marked PCT decline and documented clinical improvement.',
    caseData: createCase({
      patientAge: 42,
      sex: 'male',
      symptoms: 'Severe sepsis with ICU-level illness and improving clinical course.',
      infectionContext: 'sepsis_icu',
      clinicalImprovement: 'yes',
      currentAntibioticStatus: 'empirical',
      antibioticsDurationDays: null,
      peakPct: 45.2,
      currentPct: 5.8,
      exclusionCondition: 'none',
      clinicalNotes:
        'Adapted case: antibiotics discontinued after PCT fell by more than 80% with clinical improvement.',
      caseDescription:
        '42-year-old male with severe sepsis in ICU. Peak PCT 45.2 ng/mL, current PCT 5.8 ng/mL, clinically improving.',
    }),
    expectedReferenceLabel: 'consider_discontinuation',
    tags: ['sepsis_icu', 'pct_decline_gt_80', 'clinical_improvement_yes'],
    sourceNote:
      'Adapted from public Thermo Fisher PCT Case Study 2; antibiotics discontinued after >80% PCT reduction and clinical improvement.',
    limitations: [
      'Adapted source case, not a full clinical gold standard.',
      'Some clinical details, microbiology, antibiotic duration, and comorbidities are not represented.',
    ],
  },
  {
    id: 'thermo-hemodialysis-pneumonia-caution',
    title: 'Hemodialysis pneumonia de-escalation',
    sourceType: 'thermo_case_adapted',
    description:
      'Pneumonia case with renal/hemodialysis caveat; current deterministic engine treats this as a clinical-review caution.',
    caseData: createCase({
      patientAge: 83,
      sex: 'male',
      symptoms: 'Pneumonia in a patient receiving hemodialysis.',
      infectionContext: 'other_or_unclear',
      clinicalImprovement: 'yes',
      currentAntibioticStatus: 'empirical',
      peakPct: 2.47,
      currentPct: 0.41,
      exclusionCondition: 'other_caution',
      clinicalNotes:
        'Hemodialysis may affect PCT kinetics; use as a caution case rather than an automatic discontinuation case.',
      caseDescription:
        '83-year-old male with pneumonia and hemodialysis. Peak PCT 2.47 ng/mL, current PCT 0.41 ng/mL, clinically improving.',
    }),
    expectedReferenceLabel: 'clinical_review_required',
    tags: ['pneumonia', 'hemodialysis', 'renal_caution', 'clinical_review_required'],
    sourceNote:
      'Adapted from public Thermo Fisher PCT Case Study 1; renal clearance makes this a caution case.',
    limitations: [
      'Adapted source case, not a full clinical gold standard.',
      'Hemodialysis is mapped to other_caution because the current schema does not have a renal-replacement-therapy field.',
      'Infection context is set to other_or_unclear because the current reference engine has no pneumonia-with-renal-caveat context.',
    ],
  },
  {
    id: 'thermo-lrti-low-pct-discontinuation',
    title: 'LRTI viral/bacterial low PCT',
    sourceType: 'thermo_case_adapted',
    description:
      'LRTI/non-ICU case with consistently low serial PCT and clinical improvement.',
    caseData: createCase({
      patientAge: 65,
      sex: 'female',
      symptoms: 'Lower respiratory tract infection symptoms with low serial PCT.',
      infectionContext: 'lrti_non_icu',
      clinicalImprovement: 'yes',
      currentAntibioticStatus: 'empirical',
      peakPct: 0.12,
      currentPct: 0.09,
      exclusionCondition: 'none',
      clinicalNotes:
        'Low serial PCT values and clinical improvement supported antibiotic discontinuation in the adapted case.',
      caseDescription:
        '65-year-old female with LRTI/non-ICU context. Peak PCT 0.12 ng/mL, current PCT 0.09 ng/mL, clinically improving.',
    }),
    expectedReferenceLabel: 'consider_discontinuation',
    tags: ['lrti_non_icu', 'low_pct', 'clinical_improvement_yes'],
    sourceNote:
      'Adapted from public Thermo Fisher PCT Case Study 4; low serial PCT and clinical improvement supported antibiotic discontinuation.',
    limitations: [
      'Adapted source case, not a full clinical gold standard.',
      'The app reference logic uses simplified PCT threshold and decline rules only.',
    ],
  },
  {
    id: 'thermo-covid-low-pct-no-continuation',
    title: 'COVID bacterial coinfection exclusion',
    sourceType: 'thermo_case_adapted',
    description:
      'COVID/LRTI case with consistently low PCT; adapted as clinically improving to exercise the low-threshold discontinuation path.',
    caseData: createCase({
      patientAge: 77,
      sex: 'female',
      symptoms: 'COVID respiratory illness with question of bacterial coinfection.',
      infectionContext: 'lrti_non_icu',
      clinicalImprovement: 'yes',
      currentAntibioticStatus: 'empirical',
      peakPct: 0.13,
      currentPct: 0.1,
      exclusionCondition: 'none',
      clinicalNotes:
        'Consistently low PCT did not support continuing antibiotics in the adapted source narrative.',
      caseDescription:
        '77-year-old female with COVID/LRTI context. Peak PCT 0.13 ng/mL, current PCT 0.10 ng/mL, no exclusion condition recorded.',
    }),
    expectedReferenceLabel: 'consider_discontinuation',
    tags: ['covid', 'lrti_non_icu', 'low_pct'],
    sourceNote:
      'Adapted from public Thermo Fisher PCT Case Study 8; antibiotics not continued due to consistently low PCT.',
    limitations: [
      'Adapted source case, not a full clinical gold standard.',
      'Clinical improvement is set to yes to match the current deterministic reference gate.',
      'COVID-specific exclusions and coinfection diagnostics are not represented in the current schema.',
    ],
  },
  {
    id: 'thermo-covid-empirical-stop-low-pct',
    title: 'COVID empirical antibiotic stopping',
    sourceType: 'thermo_case_adapted',
    description:
      'COVID/LRTI case where low PCT supports stopping empirical antibiotics under the benchmark rule.',
    caseData: createCase({
      patientAge: 55,
      sex: 'male',
      symptoms: 'COVID respiratory illness with empirical antibiotics and low PCT.',
      infectionContext: 'lrti_non_icu',
      clinicalImprovement: 'yes',
      currentAntibioticStatus: 'empirical',
      peakPct: 0.16,
      currentPct: 0.16,
      exclusionCondition: 'none',
      clinicalNotes:
        'Low PCT supported stopping empirical antibiotics in the adapted source narrative.',
      caseDescription:
        '55-year-old male with COVID/LRTI context. Peak and current PCT 0.16 ng/mL, clinically improving.',
    }),
    expectedReferenceLabel: 'consider_discontinuation',
    tags: ['covid', 'lrti_non_icu', 'low_pct', 'empirical_antibiotics'],
    sourceNote:
      'Adapted from public Thermo Fisher PCT Case Study 9; low PCT supported stopping empirical antibiotics.',
    limitations: [
      'Adapted source case, not a full clinical gold standard.',
      'Clinical improvement is set to yes so the simplified benchmark gate can evaluate discontinuation.',
    ],
  },
  {
    id: 'synthetic-lrti-improving-decline-gt-80',
    title: 'LRTI improving with >80% PCT decline',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic case where clinical improvement and PCT decline support considering discontinuation despite current PCT above the LRTI threshold.',
    caseData: createCase({
      patientAge: 61,
      sex: 'female',
      symptoms: 'Improving cough and fever after empiric therapy.',
      infectionContext: 'lrti_non_icu',
      clinicalImprovement: 'yes',
      peakPct: 2,
      currentPct: 0.3,
      exclusionCondition: 'none',
      caseDescription:
        'LRTI/non-ICU synthetic case with current PCT 0.3 ng/mL and 85% decline from peak.',
    }),
    expectedReferenceLabel: 'consider_discontinuation',
    tags: ['synthetic', 'lrti_non_icu', 'pct_decline_gt_80'],
    sourceNote:
      'Synthetic algorithm-derived case designed from the deterministic benchmark rules.',
    limitations: ['Not based on a real patient case.', 'Contains only fields required to exercise the rule path.'],
  },
  {
    id: 'synthetic-lrti-not-improving-decline-gt-80',
    title: 'LRTI not improving despite >80% PCT decline',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic case where PCT decline criterion is met but clinical improvement is absent.',
    caseData: createCase({
      patientAge: 65,
      sex: 'male',
      symptoms: 'Persistent fever and respiratory symptoms.',
      infectionContext: 'lrti_non_icu',
      clinicalImprovement: 'no',
      peakPct: 2,
      currentPct: 0.3,
      exclusionCondition: 'none',
      caseDescription:
        'LRTI/non-ICU synthetic case with 85% PCT decline but absent clinical improvement.',
    }),
    expectedReferenceLabel: 'continue_antibiotics',
    tags: ['synthetic', 'lrti_non_icu', 'clinical_improvement_no', 'pct_decline_gt_80'],
    sourceNote:
      'Synthetic algorithm-derived case designed to test the clinical-improvement gate.',
    limitations: ['Not based on a real patient case.', 'Clinical course is simplified to a binary improvement field.'],
  },
  {
    id: 'synthetic-sepsis-improving-below-threshold',
    title: 'ICU sepsis improving below 0.5',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic ICU sepsis case where current PCT is below the sepsis threshold and clinical improvement is present.',
    caseData: createCase({
      patientAge: 58,
      sex: 'female',
      symptoms: 'Improving sepsis physiology in ICU.',
      infectionContext: 'sepsis_icu',
      clinicalImprovement: 'yes',
      peakPct: 1.8,
      currentPct: 0.42,
      exclusionCondition: 'none',
      caseDescription:
        'ICU sepsis synthetic case with current PCT 0.42 ng/mL below the 0.5 ng/mL threshold.',
    }),
    expectedReferenceLabel: 'consider_discontinuation',
    tags: ['synthetic', 'sepsis_icu', 'current_pct_below_threshold'],
    sourceNote:
      'Synthetic algorithm-derived case designed from the deterministic benchmark rules.',
    limitations: ['Not based on a real patient case.', 'No organ-support or microbiology details included.'],
  },
  {
    id: 'synthetic-sepsis-not-improving-high-pct',
    title: 'ICU sepsis not improving with high PCT',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic ICU sepsis case where clinical improvement is absent and current PCT remains high.',
    caseData: createCase({
      patientAge: 70,
      sex: 'male',
      symptoms: 'Persistent septic physiology.',
      infectionContext: 'sepsis_icu',
      clinicalImprovement: 'no',
      peakPct: 3,
      currentPct: 1.2,
      exclusionCondition: 'none',
      caseDescription:
        'ICU sepsis synthetic case with current PCT 1.2 ng/mL and no clinical improvement.',
    }),
    expectedReferenceLabel: 'continue_antibiotics',
    tags: ['synthetic', 'sepsis_icu', 'clinical_improvement_no', 'high_pct'],
    sourceNote:
      'Synthetic algorithm-derived case designed to test continue_antibiotics behavior.',
    limitations: ['Not based on a real patient case.', 'PCT and clinical improvement are simplified.'],
  },
  {
    id: 'synthetic-s-aureus-bacteremia-exception',
    title: 'S. aureus bacteremia exception',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic case where PCT criteria may be favorable but S. aureus bacteremia requires clinical review.',
    caseData: createCase({
      patientAge: 54,
      sex: 'male',
      symptoms: 'Documented S. aureus bacteremia with improving inflammatory markers.',
      infectionContext: 'sepsis_icu',
      clinicalImprovement: 'yes',
      peakPct: 5,
      currentPct: 0.4,
      exclusionCondition: 's_aureus_bacteremia',
      caseDescription:
        'Synthetic S. aureus bacteremia exception case with favorable PCT but exclusion condition present.',
    }),
    expectedReferenceLabel: 'clinical_review_required',
    tags: ['synthetic', 'exception', 's_aureus_bacteremia'],
    sourceNote:
      'Synthetic algorithm-derived case designed to test exclusion handling.',
    limitations: ['Not based on a real patient case.', 'Bacteremia complexity is represented by a single exclusion field.'],
  },
  {
    id: 'synthetic-endocarditis-exception',
    title: 'Endocarditis exception',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic endocarditis case requiring clinical review despite low current PCT.',
    caseData: createCase({
      patientAge: 47,
      sex: 'female',
      symptoms: 'Endocarditis with improving fever curve.',
      infectionContext: 'sepsis_icu',
      clinicalImprovement: 'yes',
      peakPct: 2.1,
      currentPct: 0.3,
      exclusionCondition: 'endocarditis',
      caseDescription:
        'Synthetic endocarditis exception case with current PCT below sepsis threshold.',
    }),
    expectedReferenceLabel: 'clinical_review_required',
    tags: ['synthetic', 'exception', 'endocarditis'],
    sourceNote:
      'Synthetic algorithm-derived case designed to test exclusion handling.',
    limitations: ['Not based on a real patient case.', 'Endocarditis treatment nuance is simplified.'],
  },
  {
    id: 'synthetic-missing-clinical-improvement',
    title: 'Missing clinical improvement',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic case with favorable PCT but unclear clinical improvement.',
    caseData: createCase({
      patientAge: 63,
      sex: 'female',
      symptoms: 'Respiratory infection with incomplete clinical trajectory data.',
      infectionContext: 'lrti_non_icu',
      clinicalImprovement: 'unclear',
      peakPct: 1.6,
      currentPct: 0.2,
      exclusionCondition: 'none',
      caseDescription:
        'Synthetic case where clinical improvement is unclear despite PCT below threshold.',
    }),
    expectedReferenceLabel: 'insufficient_information',
    tags: ['synthetic', 'missing_clinical_improvement', 'insufficient_information'],
    sourceNote:
      'Synthetic algorithm-derived case designed to test missing clinical improvement handling.',
    limitations: ['Not based on a real patient case.', 'Clinical improvement is intentionally ambiguous.'],
  },
  {
    id: 'synthetic-missing-infection-context',
    title: 'Missing infection context',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic case where infection context is unavailable, preventing threshold selection.',
    caseData: createCase({
      patientAge: 59,
      sex: 'male',
      symptoms: 'Possible infection with unclear syndrome.',
      infectionContext: 'other_or_unclear',
      clinicalImprovement: 'yes',
      peakPct: 1.1,
      currentPct: 0.2,
      exclusionCondition: 'none',
      caseDescription:
        'Synthetic case with other_or_unclear infection context and no applicable threshold baseline.',
    }),
    expectedReferenceLabel: 'insufficient_information',
    tags: ['synthetic', 'missing_infection_context', 'insufficient_information'],
    sourceNote:
      'Synthetic algorithm-derived case designed to test infection-context gating.',
    limitations: [
      'Not based on a real patient case.',
      'The current ClinicalCase type represents missing context as other_or_unclear.',
    ],
  },
  {
    id: 'synthetic-borderline-lrti-026-decline-lt-80',
    title: 'Borderline LRTI current PCT 0.26 with decline <80',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic LRTI case just above the 0.25 threshold with insufficient decline.',
    caseData: createCase({
      patientAge: 50,
      sex: 'female',
      symptoms: 'Improving LRTI symptoms.',
      infectionContext: 'lrti_non_icu',
      clinicalImprovement: 'yes',
      peakPct: 1,
      currentPct: 0.26,
      exclusionCondition: 'none',
      caseDescription:
        'Synthetic borderline LRTI case: current PCT 0.26 ng/mL and 74% decline from peak.',
    }),
    expectedReferenceLabel: 'continue_antibiotics',
    tags: ['synthetic', 'borderline', 'lrti_non_icu', 'pct_decline_lt_80'],
    sourceNote:
      'Synthetic algorithm-derived case designed to test threshold boundary behavior.',
    limitations: ['Not based on a real patient case.', 'Borderline values are intentionally selected.'],
  },
  {
    id: 'synthetic-borderline-sepsis-051-decline-lt-80',
    title: 'Borderline sepsis current PCT 0.51 with decline <80',
    sourceType: 'synthetic_algorithm_case',
    description:
      'Synthetic sepsis case just above the 0.5 threshold with insufficient decline.',
    caseData: createCase({
      patientAge: 68,
      sex: 'male',
      symptoms: 'Improving ICU sepsis symptoms.',
      infectionContext: 'sepsis_icu',
      clinicalImprovement: 'yes',
      peakPct: 2,
      currentPct: 0.51,
      exclusionCondition: 'none',
      caseDescription:
        'Synthetic borderline sepsis case: current PCT 0.51 ng/mL and 74.5% decline from peak.',
    }),
    expectedReferenceLabel: 'continue_antibiotics',
    tags: ['synthetic', 'borderline', 'sepsis_icu', 'pct_decline_lt_80'],
    sourceNote:
      'Synthetic algorithm-derived case designed to test threshold boundary behavior.',
    limitations: ['Not based on a real patient case.', 'Borderline values are intentionally selected.'],
  },
]

export function getBenchmarkCaseById(id: string): BenchmarkCase | undefined {
  return benchmarkCases.find((benchmarkCase) => benchmarkCase.id === id)
}
