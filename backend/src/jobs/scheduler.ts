import { getSettings } from '../services/common';
import { scanExpiry } from '../services/stock';
import { logger } from '../utils/logger';

/** Hourly expiry scan: raises EXPIRING/EXPIRED notifications from persisted batch data. */
export function startJobs() {
  const run = async () => {
    try {
      const s = await getSettings();
      const n = await scanExpiry(s.stock.expiryAlertDays);
      logger.info({ flagged: n }, 'expiry scan complete');
    } catch (err) {
      logger.error({ err }, 'expiry scan failed');
    }
  };
  setTimeout(run, 5000).unref();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
