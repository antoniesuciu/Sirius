/** What the fast path says aloud. F29: replies come back in the language of the request. */

export type Lang = 'en' | 'ro';

export function replyLang(detected: string): Lang {
  return detected.toLowerCase().startsWith('ro') ? 'ro' : 'en';
}

const en = {
  added: (title: string) => `Added ${title} to today.`,
  listed: (text: string) => `${text} is on your list.`,
  reminded: (time: string) => `I'll remind you at ${time}.`,
  next: (title: string) => `Next is ${title}.`,
  nextReminder: (label: string, time: string) => `Next is ${label}, at ${time}.`,
  nothingNext: 'Nothing is waiting for you. A good moment to rest.',
  time: (time: string) => `It's ${time}.`,
  breathing: 'Breathing with you.',
  quiet: 'Done for today. Rest well.',
  snoozed: (label: string) => `${label} can wait an hour.`,
  nothingToSnooze: 'There is nothing to snooze.',
  confirmed: 'Done.',
  rejected: "Alright, I'll leave it as it is.",
  needsTap: 'That one deletes something, so it needs a tap on the screen.',
  nothingToConfirm: 'There is nothing to confirm.',
  tooLate: 'That one has passed. It is on the screen if you still want it.',
  stillAnswering: 'I am still answering the last one. Give me a moment.',
};

const ro: typeof en = {
  added: (title) => `Am adăugat ${title} la azi.`,
  listed: (text) => `Am pus ${text} pe listă.`,
  reminded: (time) => `Îți amintesc la ${time}.`,
  next: (title) => `Urmează ${title}.`,
  nextReminder: (label, time) => `Urmează ${label}, la ${time}.`,
  nothingNext: 'Nu te așteaptă nimic. E un moment bun de odihnă.',
  time: (time) => `Este ${time}.`,
  breathing: 'Respirăm împreună.',
  quiet: 'Gata pe azi. Odihnă plăcută.',
  snoozed: (label) => `${label} poate aștepta o oră.`,
  nothingToSnooze: 'Nu am ce să amân.',
  confirmed: 'Gata.',
  rejected: 'Bine, las așa.',
  needsTap: 'Asta șterge ceva, așa că e nevoie de o atingere pe ecran.',
  nothingToConfirm: 'Nu am nimic de confirmat.',
  tooLate: 'A trecut momentul. Rămâne pe ecran, dacă o mai vrei.',
  stillAnswering: 'Încă răspund la ce ai cerut. Mai așteaptă puțin.',
};

export function replies(lang: Lang): typeof en {
  return lang === 'ro' ? ro : en;
}
