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
  nothingNext: 'Nothing left on today.',
  time: (time: string) => `It's ${time}.`,
  breathing: 'Starting the breathing exercise.',
  quiet: 'Done for today. Reminders are off until tomorrow.',
  snoozed: (label: string) => `${label} moved back an hour.`,
  nothingToSnooze: 'There is nothing to snooze.',
  confirmed: 'Done.',
  rejected: 'OK, left as it is.',
  needsTap: 'That one deletes something, so it needs a tap on the screen.',
  nothingToConfirm: 'There is nothing to confirm.',
  tooLate: 'That card has expired. It is still on the screen.',
  stillAnswering: 'Still working on the last one.',
};

const ro: typeof en = {
  added: (title) => `Am adăugat ${title} la azi.`,
  listed: (text) => `Am pus ${text} pe listă.`,
  reminded: (time) => `Îți amintesc la ${time}.`,
  next: (title) => `Urmează ${title}.`,
  nextReminder: (label, time) => `Urmează ${label}, la ${time}.`,
  nothingNext: 'Nu mai e nimic pe azi.',
  time: (time) => `Este ${time}.`,
  breathing: 'Pornesc exercițiul de respirație.',
  quiet: 'Gata pe azi. Mementourile sunt oprite până mâine.',
  snoozed: (label) => `Am amânat ${label} cu o oră.`,
  nothingToSnooze: 'Nu am ce să amân.',
  confirmed: 'Gata.',
  rejected: 'Bine, rămâne cum era.',
  needsTap: 'Asta șterge ceva, așa că e nevoie de o atingere pe ecran.',
  nothingToConfirm: 'Nu am nimic de confirmat.',
  tooLate: 'Cardul a expirat. Rămâne pe ecran.',
  stillAnswering: 'Încă lucrez la cererea de dinainte.',
};

export function replies(lang: Lang): typeof en {
  return lang === 'ro' ? ro : en;
}
