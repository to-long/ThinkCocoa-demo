// Auto-composed message bundle for the "es" locale. Static imports here
// mean rspack packs all 16 feature dictionaries into ONE per-locale chunk,
// dynamically loaded by ./messages.ts — so only the active locale ships.

import admin from '../../features/admin/intl/es.json';
import auth from '../../features/auth/intl/es.json';
import clmrs from '../../features/clmrs/intl/es.json';
import coaching from '../../features/coaching/intl/es.json';
import dashboard from '../../features/dashboard/intl/es.json';
import farmers from '../../features/farmers/intl/es.json';
import farms from '../../features/farms/intl/es.json';
import inspections from '../../features/inspections/intl/es.json';
import primaryEvac from '../../features/primary-evac/intl/es.json';
import profile from '../../features/profile/intl/es.json';
import purchases from '../../features/purchases/intl/es.json';
import reports from '../../features/reports/intl/es.json';
import traceability from '../../features/traceability/intl/es.json';
import training from '../../features/training/intl/es.json';
import vsla from '../../features/vsla/intl/es.json';
import shared from './es.json';

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
