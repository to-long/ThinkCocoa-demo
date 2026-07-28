// Auto-composed message bundle for the "en" locale. Static imports here
// mean rspack packs all 16 feature dictionaries into ONE per-locale chunk,
// dynamically loaded by ./messages.ts — so only the active locale ships.

import admin from '../../features/admin/intl/en.json';
import auth from '../../features/auth/intl/en.json';
import clmrs from '../../features/clmrs/intl/en.json';
import coaching from '../../features/coaching/intl/en.json';
import dashboard from '../../features/dashboard/intl/en.json';
import farmers from '../../features/farmers/intl/en.json';
import farms from '../../features/farms/intl/en.json';
import inspections from '../../features/inspections/intl/en.json';
import primaryEvac from '../../features/primary-evac/intl/en.json';
import profile from '../../features/profile/intl/en.json';
import purchases from '../../features/purchases/intl/en.json';
import reports from '../../features/reports/intl/en.json';
import traceability from '../../features/traceability/intl/en.json';
import training from '../../features/training/intl/en.json';
import vsla from '../../features/vsla/intl/en.json';
import shared from './en.json';

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
