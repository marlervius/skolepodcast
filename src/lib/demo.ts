import type { Episode, Topic } from "./types";

export const DEMO_EMAIL = "demo@lytterom.no";
export const DEMO_TEACHER_ID = "demo-teacher";
export const DEMO_COURSE_ID = "demo-history";

export const demoCourse = {
  title: "Historie VG3",
  subject: "Historie",
  class_label: "VG3",
  description: "Fra mellomkrigstid til kald krig. Lytt til korte episoder om hendelsene og ideene som formet det tjuende århundret.",
  code: "HIST-VG3",
  accent_color: "#C0563B",
};

const topics: Pick<Topic, "id" | "title" | "description">[] = [
  { id: "demo-interwar", title: "Mellomkrigstiden", description: "Fra første verdenskrig til økonomisk krise og framvekst av diktaturer." },
  { id: "demo-world-war", title: "Andre verdenskrig", description: "Årsaker, okkupasjon og motstand i en global krig." },
  { id: "demo-cold-war", title: "Den kalde krigen", description: "Ideologisk konflikt, stormaktsrivalisering og et delt Europa." },
];

export const demoTopics = topics.map((topic, index) => ({
  ...topic,
  course_id: DEMO_COURSE_ID,
  sort_order: index,
}));

const lessons: Pick<Episode, "topic_id" | "title" | "description" | "study_notes" | "duration_seconds" | "sort_order">[] = [
  {
    topic_id: "demo-interwar",
    title: "Mellomkrigstiden på tre minutter",
    description: "Hva skjedde med demokratiet og økonomien i Europa mellom de to verdenskrigene?",
    study_notes: "• Versaillestraktaten la nye politiske og økonomiske rammer etter 1919.\n• Børskrakket i 1929 fikk følger langt utenfor USA.\n• Økonomisk krise bidro til å svekke oppslutningen om demokratiet i flere land.\n\nRefleksjon: Hvorfor kan en økonomisk krise få ulike politiske følger i ulike land?",
    duration_seconds: 78,
    sort_order: 0,
  },
  {
    topic_id: "demo-world-war",
    title: "Hvordan begynte andre verdenskrig?",
    description: "Fra tysk opprustning og appeasement til invasjonen av Polen i september 1939.",
    study_notes: "• Münchenavtalen i 1938 lot Tyskland overta Sudetenland.\n• Tyskland og Sovjetunionen inngikk en ikke-angrepspakt i august 1939.\n• Invasjonen av Polen utløste britiske og franske krigserklæringer.\n\nRefleksjon: Hvordan kan man skille mellom langsiktige årsaker og utløsende hendelser?",
    duration_seconds: 92,
    sort_order: 0,
  },
  {
    topic_id: "demo-world-war",
    title: "Okkupasjon og motstand i Norge",
    description: "Norge under okkupasjonen, fra 9. april 1940 til frigjøringen i 1945.",
    study_notes: "• Tyskland invaderte Norge 9. april 1940.\n• Motstanden tok både sivile og militære former.\n• Norske jøder ble arrestert og deportert med deltakelse fra norske myndighetspersoner.\n\nRefleksjon: Hvordan kan dagbøker og offentlige dokumenter fortelle ulike historier om den samme tiden?",
    duration_seconds: 64,
    sort_order: 1,
  },
  {
    topic_id: "demo-cold-war",
    title: "Den kalde krigen forklart",
    description: "Hvorfor ble det konflikt mellom USA og Sovjetunionen, og hvordan preget den resten av verden?",
    study_notes: "• Gjensidig mistillit preget forholdet mellom stormaktene etter 1945.\n• NATO og Warszawapakten organiserte militære allianser i hver sin blokk.\n• Cubakrisen i 1962 viste hvor farlig atomvåpenkappløpet kunne bli.\n\nRefleksjon: Hva skjuler ordet «kald» om hvordan krigen ble opplevd utenfor Europa?",
    duration_seconds: 85,
    sort_order: 0,
  },
];

export const demoEpisodes: Episode[] = lessons.map((lesson, index) => ({
  ...lesson,
  id: `demo-episode-${index + 1}`,
  course_id: DEMO_COURSE_ID,
  media_type: "audio",
  media_url: `/demo/historie-${index + 1}.wav`,
  embed_url: "",
}));
