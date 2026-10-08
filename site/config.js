/*
 * Сайт баптаулары. Іске қосар алдында тек осы файлды өзгерту жеткілікті.
 */
window.APP_CONFIG = {
  // Google Apps Script веб-қосымшасының мекенжайы (README.md, 2-қадам).
  // Бос тұрса, сайт «сынақ режимінде» істейді: жауаптар еш жерге жіберілмейді.
  endpoint: "https://script.google.com/macros/s/AKfycbzZOvrl3yk3WO_dqm6gloVEq3QirSTYFFL5me-BpGHOJp-zBGPXDlClb7Y2ksbqcwCpog/exec",

  // Лек атауы. Сілтемеге ?c=... қосып та беруге болады: site/?c=lek-2
  cohort: "pilot-2026-10",

  // Сауалнама нұсқасы. Сұрақтар немесе есептеу өзгергенде арттырылады.
  version: "v2.2",

  // true болса, оқушы соңында өзінің мүмкін бағыттарын көреді.
  // Әдепкіде false: нәтижені мұғалім вебинарда түсіндіріп береді.
  showResultToStudent: false,

  // Соңғы бетте көрсетілетін байланыс (мысалы, Telegram не WhatsApp). Бос қалдыруға болады.
  contact: "",
};
