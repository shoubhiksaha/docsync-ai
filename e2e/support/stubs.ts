// A successful /api/sync answer, so browser tests can finish the save without a Google account.
export const SAVED = {
  success: true,
  partial: false,
  message: 'Successfully synced to all destinations',
  errors: [],
  warnings: [],
  destinations: {
    sheets: { status: 'success', code: 'saved' },
    notion: { status: 'skipped', code: 'not_connected' },
    media: { status: 'success', code: 'saved' },
  },
  spreadsheetId: 'e2e-sheet',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/e2e-sheet/edit',
};
