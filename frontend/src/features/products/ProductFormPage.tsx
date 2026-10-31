import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { api, errMsg, get, send } from '@/lib/api';
import { centsToInput, toCents } from '@/lib/format';
import type { Named, Product, Settings, Unit } from '@/types';

const money = z
  .string()
  .trim()
  .refine((v) => Number.isFinite(toCents(v)), 'Enter a valid amount, e.g. 125.50');
const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  sku: z.string().trim().min(1, 'SKU is required').max(50),
  barcode: z.string().trim().max(50).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().min(1, 'Choose a category'),
  brand: z.string().optional(),
  unit: z.string().min(1, 'Choose a unit'),
  cost: money,
  price: money,
  taxCode: z.string().optional(),
  reorderLevel: z.string().refine((v) => v === '' || Number(v) >= 0, 'Must be zero or more'),
  packSize: z.string().refine((v) => v === '' || Number(v) >= 1, 'Must be at least 1'),
  trackExpiry: z.boolean(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
});
type Values = z.infer<typeof schema>;

export function ProductFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const product = useQuery({
    queryKey: ['product', id],
    queryFn: () => get<Product>(`/products/${id}`),
    enabled: editing,
  });
  const cats = useQuery({
    queryKey: ['categories-all'],
    queryFn: () => get<Named[]>('/categories', { all: 'true', active: 'true' }),
  });
  const brands = useQuery({
    queryKey: ['brands-all'],
    queryFn: () => get<Named[]>('/brands', { all: 'true', active: 'true' }),
  });
  const units = useQuery({
    queryKey: ['units-all'],
    queryFn: () => get<Unit[]>('/units', { all: 'true', active: 'true' }),
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      sku: '',
      barcode: '',
      description: '',
      category: '',
      brand: '',
      unit: '',
      cost: '0.00',
      price: '',
      taxCode: '',
      reorderLevel: '0',
      packSize: '1',
      trackExpiry: false,
      status: 'ACTIVE',
    },
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  useEffect(() => {
    const p = product.data?.data as (Product & { category: Named; brand?: Named; unit: Unit }) | undefined;
    if (p) {
      reset({
        name: p.name,
        sku: p.sku,
        barcode: p.barcode ?? '',
        description: p.description ?? '',
        category: p.category?._id ?? '',
        brand: p.brand?._id ?? '',
        unit: p.unit?._id ?? '',
        cost: centsToInput(p.costCents),
        price: centsToInput(p.priceCents),
        taxCode: p.taxCode ?? '',
        reorderLevel: String(p.reorderLevelMilli / 1000),
        packSize: String(p.packSize ?? 1),
        trackExpiry: p.trackExpiry,
        status: p.status,
      });
    }
  }, [product.data, reset]);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const existingImage = (product.data?.data as { imageUrl?: string } | undefined)?.imageUrl;
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTouched, setLinkTouched] = useState(false);
  const [linkBroken, setLinkBroken] = useState(false);
  const trimmedLink = linkUrl.trim();
  const linkValid = trimmedLink === '' || /^https?:\/\/\S+$/i.test(trimmedLink);
  const shownImage =
    preview ??
    (linkTouched && trimmedLink && linkValid ? trimmedLink : null) ??
    (linkTouched ? undefined : existingImage);

  const pickImage = (f?: File) => {
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
      return void toast.error('Use a JPEG, PNG or WebP image');
    if (f.size > 2 * 1024 * 1024) return void toast.error('Image must be 2 MB or smaller');
    setImageFile(f);
    setLinkUrl('');
    setLinkTouched(false);
  };

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const body = {
        name: v.name,
        sku: v.sku,
        barcode: v.barcode ?? '',
        description: v.description,
        category: v.category,
        brand: v.brand ?? '',
        unit: v.unit,
        costCents: toCents(v.cost),
        priceCents: toCents(v.price),
        taxCode: v.taxCode ?? '',
        reorderLevel: Number(v.reorderLevel || 0),
        packSize: Number(v.packSize || 1),
        trackExpiry: v.trackExpiry,
        status: v.status,
        // a pasted link replaces the current image; an uploaded file (sent below) takes priority
        ...(linkTouched && !imageFile ? { imageUrl: trimmedLink } : {}),
      };
      const saved = editing
        ? await send<Product>('patch', `/products/${id}`, body)
        : await send<Product>('post', '/products', body);
      if (imageFile) {
        // the product exists now; if only the image fails the product is still saved
        try {
          const fd = new FormData();
          fd.append('image', imageFile);
          await api.post(`/products/${saved.data._id}/image`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch (e) {
          toast.error(`Product saved, but the image upload failed: ${errMsg(e)}`);
        }
      }
      return saved;
    },
    onSuccess: (r) => {
      toast.success(editing ? 'Product updated' : 'Product created');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', id] });
      nav(`/products/${r.data._id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const loading = (editing && product.isLoading) || cats.isLoading || units.isLoading;
  return (
    <>
      <PageHeader
        title={editing ? 'Edit product' : 'Add product'}
        description="Prices and costs are in Sri Lankan rupees."
      />
      <Loadable loading={loading} error={(product.error ?? cats.error ?? units.error) as Error | null}>
        <form
          onSubmit={handleSubmit((v) => {
            if (!linkValid) return void toast.error('Image link must start with http:// or https://');
            save.mutate(v);
          })}
          noValidate
          className="grid gap-4 lg:grid-cols-3"
        >
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Basic information</CardTitle>
            </CardHeader>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Product name" error={errors.name?.message} className="sm:col-span-2">
                <Input {...register('name')} />
              </Field>
              <Field label="SKU" error={errors.sku?.message} hint="Unique. Stored in upper case.">
                <Input {...register('sku')} />
              </Field>
              <Field label="Barcode" error={errors.barcode?.message} hint="Optional. Unique across products.">
                <Input inputMode="numeric" {...register('barcode')} />
              </Field>
              <Field label="Category" error={errors.category?.message}>
                <Select {...register('category')}>
                  <option value="">Select…</option>
                  {cats.data?.data.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Brand">
                <Select {...register('brand')}>
                  <option value="">None</option>
                  {brands.data?.data.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Textarea {...register('description')} />
              </Field>
            </CardBody>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Product image</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 text-center">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  aria-label="Product image"
                  onChange={(e) => {
                    pickImage(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {shownImage ? (
                  <div className="relative mx-auto h-40 w-40">
                    <img
                      src={shownImage}
                      onError={() => setLinkBroken(true)}
                      onLoad={() => setLinkBroken(false)}
                      alt="Product preview"
                      className="h-40 w-40 rounded-lg border object-cover"
                    />
                    {(preview || (linkTouched && trimmedLink)) && (
                      <button
                        type="button"
                        aria-label="Remove selected image"
                        onClick={() => {
                          setImageFile(null);
                          setLinkUrl('');
                          setLinkTouched(false);
                          setLinkBroken(false);
                        }}
                        className="absolute -right-2 -top-2 rounded-full border bg-background p-1 shadow-card hover:bg-surface"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="mx-auto grid h-40 w-40 place-items-center rounded-lg border-2 border-dashed text-sm text-muted-foreground hover:bg-surface"
                  >
                    No image yet
                  </button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  <ImagePlus className="h-4 w-4" /> {shownImage ? 'Change image' : 'Choose image'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Optional. JPEG, PNG or WebP, up to 2 MB. Uploaded when you save.
                </p>
                <div className="space-y-1.5 border-t pt-3 text-left">
                  <label htmlFor="image-link" className="text-sm font-medium">
                    Or paste an image link
                  </label>
                  <Input
                    id="image-link"
                    type="url"
                    inputMode="url"
                    placeholder="https://example.com/rice.jpg"
                    value={linkUrl}
                    aria-invalid={!linkValid}
                    onChange={(e) => {
                      setLinkUrl(e.target.value);
                      setLinkTouched(true);
                      setLinkBroken(false);
                      if (e.target.value.trim()) setImageFile(null);
                    }}
                  />
                  {!linkValid && (
                    <p role="alert" className="text-xs text-danger">
                      The link must start with http:// or https://
                    </p>
                  )}
                  {linkValid && linkBroken && trimmedLink && (
                    <p role="alert" className="text-xs text-warning">
                      This link did not load as an image. Check it, or the site may block other websites from
                      using it.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The picture stays on the other website. If they remove it, it disappears here too.
                    Uploading is more reliable.
                  </p>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Pricing & tax</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <Field label="Purchase cost (Rs.)" error={errors.cost?.message}>
                  <Input inputMode="decimal" {...register('cost')} />
                </Field>
                <Field
                  label="Selling price (Rs.)"
                  error={errors.price?.message}
                  hint={
                    settings.data?.data.priceIncludesTax ? 'Prices include tax' : 'Tax is added at checkout'
                  }
                >
                  <Input inputMode="decimal" {...register('price')} />
                </Field>
                <Field label="Tax" hint="Rates are configured in Settings.">
                  <Select {...register('taxCode')}>
                    <option value="">No tax</option>
                    {settings.data?.data.taxRates.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name} ({(t.rateBps / 100).toFixed(2)}%)
                      </option>
                    ))}
                  </Select>
                </Field>
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Stock rules</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <Field label="Unit of measure" error={errors.unit?.message}>
                  <Select {...register('unit')}>
                    <option value="">Select…</option>
                    {units.data?.data.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name} ({u.symbol}){u.decimals ? ' · decimals' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Pack size"
                  error={errors.packSize?.message}
                  hint="Base units per pack (for purchasing reference)."
                >
                  <Input inputMode="numeric" {...register('packSize')} />
                </Field>
                <Field
                  label="Reorder threshold"
                  error={errors.reorderLevel?.message}
                  hint="Low-stock alert at or below this quantity."
                >
                  <Input inputMode="decimal" {...register('reorderLevel')} />
                </Field>
                <Checkbox
                  label="Track batches & expiry dates"
                  {...register('trackExpiry')}
                  disabled={
                    editing && product.data?.data.onHandMilli ? product.data.data.onHandMilli > 0 : false
                  }
                />
                {editing && (
                  <Field label="Status">
                    <Select {...register('status')}>
                      <option value="ACTIVE">Active</option>
                      <option value="ARCHIVED">Archived</option>
                    </Select>
                  </Field>
                )}
              </CardBody>
            </Card>
          </div>
          <div className="flex justify-end gap-2 lg:col-span-3">
            <Button variant="outline" onClick={() => nav(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting || save.isPending}>
              {editing ? 'Save changes' : 'Create product'}
            </Button>
          </div>
        </form>
      </Loadable>
    </>
  );
}
