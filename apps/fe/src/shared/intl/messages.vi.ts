// Auto-composed message bundle for the "vi" locale. Static imports here
// mean rspack packs all 16 feature dictionaries into ONE per-locale chunk,
// dynamically loaded by ./messages.ts — so only the active locale ships.

import admin from '../../features/admin/intl/vi.json';
import auth from '../../features/auth/intl/vi.json';
import clmrs from '../../features/clmrs/intl/vi.json';
import coaching from '../../features/coaching/intl/vi.json';
import dashboard from '../../features/dashboard/intl/vi.json';
import farmers from '../../features/farmers/intl/vi.json';
import farms from '../../features/farms/intl/vi.json';
import inspections from '../../features/inspections/intl/vi.json';
import primaryEvac from '../../features/primary-evac/intl/vi.json';
import profile from '../../features/profile/intl/vi.json';
import purchases from '../../features/purchases/intl/vi.json';
import reports from '../../features/reports/intl/vi.json';
import traceability from '../../features/traceability/intl/vi.json';
import training from '../../features/training/intl/vi.json';
import vsla from '../../features/vsla/intl/vi.json';
import shared from './vi.json';

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
