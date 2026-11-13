/** Operator CSV import for product image links. Importing this module never connects to MongoDB. */
import { readFile } from 'node:fs/promises';
import { env } from '../config/env';
import { productInput } from '../modules/products/products.service';
import { parseCsv } from '../utils/csv';
import { connectDb, disconnectDb } from './connect';
import { Product } from './models';

type ImageResult = {
  row: number;
  sku: string;
  status: 'updated' | 'cleared' | 'error';
  message?: string;
};

function imageRows(csv: string) {
  const header = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/, 1)[0]
    .split(',')
    .map((column) => column.trim());
  if (!header.includes('sku') || !header.includes('imageUrl'))
    throw new Error('CSV must contain sku,imageUrl columns');
  return parseCsv(csv);
}

/** Apply valid rows independently; report bad rows without changing other products. */
export async function applyImageCsv(csv: string, options: { dryRun?: boolean } = {}) {
  const rows = imageRows(csv);
  const results: ImageResult[] = [];
  const seen = new Set<string>();
  const summary = { updated: 0, cleared: 0, failed: 0, dryRun: options.dryRun === true };

  for (const [index, row] of rows.entries()) {
    const sku = (row.sku ?? '').trim().toUpperCase();
    const imageUrl = (row.imageUrl ?? '').trim();
    const resultRow = index + 2;
    const fail = (message: string) => {
      summary.failed++;
      results.push({ row: resultRow, sku, status: 'error', message });
    };

    if (!sku) {
      fail('SKU is required');
      continue;
    }
    if (seen.has(sku)) {
      fail('Duplicate SKU in CSV');
      continue;
    }
    seen.add(sku);

    const validated = productInput.shape.imageUrl.safeParse(imageUrl);
    if (!validated.success) {
      fail(validated.error.issues[0]?.message ?? 'Invalid image URL');
      continue;
    }
    const product = await Product.findOne({ sku }).select('_id').lean();
    if (!product) {
      fail('Product not found');
      continue;
    }

    if (!options.dryRun) {
      const update = imageUrl
        ? { $set: { imageUrl: validated.data } }
        : { $unset: { imageUrl: 1 } };
      await Product.updateOne({ _id: product._id }, update, { runValidators: true });
    }
    const status = imageUrl ? 'updated' : 'cleared';
    summary[status]++;
    results.push({ row: resultRow, sku, status });
  }

  return { summary, results };
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file || flags.some((flag) => flag !== '--dry-run'))
    throw new Error('Usage: npm run set-images -- <csv-file> [--dry-run]');
  if (env.demoMode) throw new Error('set-images is disabled in public demo mode');
  const csv = await readFile(file, 'utf8');
  imageRows(csv);
  await connectDb();
  try {
    const report = await applyImageCsv(csv, { dryRun: flags.includes('--dry-run') });
    console.log(JSON.stringify(report, null, 2));
    if (report.summary.failed) process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
