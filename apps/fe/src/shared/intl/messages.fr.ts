// Auto-composed message bundle for the "fr" locale. Static imports here
// mean rspack packs all 16 feature dictionaries into ONE per-locale chunk,
// dynamically loaded by ./messages.ts — so only the active locale ships.

import admin from '../../features/admin/intl/fr.json';
import auth from '../../features/auth/intl/fr.json';
import clmrs from '../../features/clmrs/intl/fr.json';
import coaching from '../../features/coaching/intl/fr.json';
import dashboard from '../../features/dashboard/intl/fr.json';
import farmers from '../../features/farmers/intl/fr.json';
import farms from '../../features/farms/intl/fr.json';
import inspections from '../../features/inspections/intl/fr.json';
import primaryEvac from '../../features/primary-evac/intl/fr.json';
import profile from '../../features/profile/intl/fr.json';
import purchases from '../../features/purchases/intl/fr.json';
import reports from '../../features/reports/intl/fr.json';
import traceability from '../../features/traceability/intl/fr.json';
import training from '../../features/training/intl/fr.json';
import vsla from '../../features/vsla/intl/fr.json';
import shared from './fr.json';

const messages: Record<string, string> = {
  ...shared,
  ...auth,
  ...admin,
  ...farmers,
  ...farms,
  ...dashboard,
  ...inspections,
  ...coaching,
  ...training,
  ...purchases,
  ...primaryEvac,
  ...traceability,
  ...reports,
  ...vsla,
  ...clmrs,
  ...profile,
};

export default messages;
