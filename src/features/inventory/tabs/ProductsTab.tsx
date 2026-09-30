import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Group, Pagination, Stack, Text } from "@mantine/core";
import { AlertTriangle, Package } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import {
  adjustStock,
  createProduct,
  deleteProduct,
  getErrorMessage,
  IMPORT_COMPLETE_EVENT,
  listCategories,
  listCustomFields,
  listExpiringBatches,
  listProducts,
  listSuppliers,
  updateProduct,
} from "../../../api/backend";
import { usePermissions } from "../../permissions/PermissionsProvider";
import { reportOnboardingEvent } from "../../../onboarding/bus";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import type {
  PublicCategory,
  PublicProduct,
  PublicStockBatch,
  PublicSupplier,
} from "../../../types/backend";
import {
  daysUntil,
  displayToPaisa,
  EmptyState,
  exportProductsToCsv,
} from "../utils/inventoryHelpers";
import { ProductMetricsRibbon } from "../components/ProductMetricsRibbon";
import { ProductFilterDrawer } from "../components/ProductFilterDrawer";
import { ProductsToolbar } from "../components/ProductsToolbar";
import { ExpiringBatchesTable } from "../components/ExpiringBatchesTable";
import { ProductsTable } from "../components/ProductsTable";
import ProductFormPage from "../ProductFormPage";
import { StockAdjustModal } from "../modals/StockAdjustModal";
import { MovementsModal } from "../modals/MovementsModal";
import { BatchesModal } from "../modals/BatchesModal";
import { WriteOffModal } from "../modals/WriteOffModal";

export interface ProductsTabProps {
  onFormModeChange?: (active: boolean) => void;
  onOpenImport?: () => void;
}

export function ProductsTab({ onFormModeChange, onOpenImport }: ProductsTabProps) {
  const perms = usePermissions();
  const canCreate = perms.can("inventory", "create");
  const canEdit = perms.can("inventory", "edit");
  const canDelete = perms.can("inventory", "delete");
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [suppliers, setSuppliers] = useState<PublicSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Mode: list vs form (dedicated full-page)
  const [viewMode, setViewMode] = useState<"list" | "form">("list");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Editing product
  const [editingProduct, setEditingProduct] = useState<PublicProduct | null>(null);

  // Modals (stock, movements, batches, write-off, delete)
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<PublicProduct | null>(null);
  const [movementsModalOpen, setMovementsModalOpen] = useState(false);
  const [movementsProduct, setMovementsProduct] = useState<PublicProduct | null>(null);
  const [expiringBatches, setExpiringBatches] = useState<PublicStockBatch[]>([]);
  const [batchesModalOpen, setBatchesModalOpen] = useState(false);
  const [batchesProduct, setBatchesProduct] = useState<PublicProduct | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<PublicStockBatch | null>(null);
  const [productToDelete, setProductToDelete] = useState<PublicProduct | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);

  // Custom field definitions
  const [customFieldDefs, setCustomFieldDefs] = useState<
    { fieldName: string; fieldLabel: string; fieldType: string }[]
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, cats, sups] = await Promise.all([
        listProducts(),
        listCategories(),
        listSuppliers(),
      ]);
      setProducts(prods);
      setCategories(cats);
      setSuppliers(sups);
      setError(null);

      try {
        const fields = await listCustomFields();
        setCustomFieldDefs(
          fields
            .filter((f) => f.isVisible)
            .map((f) => ({
              fieldName: f.fieldName,
              fieldLabel: f.fieldLabel,
              fieldType: f.fieldType,
            })),
        );
      } catch {
        setCustomFieldDefs([]);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }

    try {
      const batches = await listExpiringBatches(30);
      setExpiringBatches(batches);
    } catch {
      setExpiringBatches([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unlisten = listen(IMPORT_COMPLETE_EVENT, () => {
      load();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [load]);

  // Lookup maps
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const supplierMap = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  );

  const categoryProductCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      if (p.categoryId) {
        counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
      }
    }
    return counts;
  }, [products]);

  const filtered = useMemo(() => {
    let result = products;

    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          p.name.toLowerCase().includes(q) ||
          (p.categoryId &&
            (categoryMap.get(p.categoryId) ?? "").toLowerCase().includes(q)) ||
          (p.supplierId &&
            (supplierMap.get(p.supplierId) ?? "").toLowerCase().includes(q)),
      );
    }

    if (selectedCategory && selectedCategory !== "all") {
      result = result.filter((p) => p.categoryId === selectedCategory);
    }

    if (selectedStatus === "in_stock") {
      result = result.filter((p) => p.quantityInStock >= 10);
    } else if (selectedStatus === "low_stock") {
      result = result.filter(
        (p) => p.quantityInStock > 0 && p.quantityInStock < 10,
      );
    } else if (selectedStatus === "out_of_stock") {
      result = result.filter((p) => p.quantityInStock <= 0);
    } else if (selectedStatus === "expiring") {
      const expiringIds = new Set(expiringBatches.map((b) => b.productId));
      result = result.filter(
        (p) =>
          expiringIds.has(p.id) ||
          (p.nextExpiryDate && daysUntil(p.nextExpiryDate) <= 30),
      );
    }

    return result;
  }, [
    products,
    query,
    selectedCategory,
    selectedStatus,
    categoryMap,
    supplierMap,
    expiringBatches,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function openCreate() {
    setEditingProduct(null);
    setViewMode("form");
    onFormModeChange?.(true);
  }

  function openEdit(prod: PublicProduct) {
    setEditingProduct(prod);
    setViewMode("form");
    onFormModeChange?.(true);
  }

  function closeForm() {
    setViewMode("list");
    setEditingProduct(null);
    onFormModeChange?.(false);
  }

  function openStock(prod: PublicProduct) {
    setStockProduct(prod);
    setStockModalOpen(true);
  }

  function openBatches(prod: PublicProduct) {
    setBatchesProduct(prod);
    setBatchesModalOpen(true);
  }

  function openMovements(prod: PublicProduct) {
    setMovementsProduct(prod);
    setMovementsModalOpen(true);
  }

  async function handleSaveProduct(values: {
    sku: string;
    name: string;
    categoryId: string;
    supplierId: string;
    costPrice: number;
    sellPrice: number;
    taxRate: number;
    quantityInStock: number;
    unit: string;
    barcode?: string | null;
    description?: string | null;
    isActive?: boolean;
  }) {
    try {
      const costPricePaisa = displayToPaisa(values.costPrice);
      const sellPricePaisa = displayToPaisa(values.sellPrice);
      const taxRateBasisPoints = Math.round(values.taxRate * 100);

      if (editingProduct) {
        await updateProduct({
          productId: editingProduct.id,
          expectedVersion: editingProduct.version,
          sku: values.sku,
          name: values.name,
          categoryId: values.categoryId,
          supplierId: values.supplierId,
          costPrice: costPricePaisa,
          sellPrice: sellPricePaisa,
          taxRate: taxRateBasisPoints,
          unit: values.unit,
          barcode: values.barcode ?? null,
          description: values.description ?? null,
          isActive: values.isActive ?? true,
        });
      } else {
        await createProduct({
          sku: values.sku,
          name: values.name,
          categoryId: values.categoryId,
          supplierId: values.supplierId,
          costPrice: costPricePaisa,
          sellPrice: sellPricePaisa,
          taxRate: taxRateBasisPoints,
          quantityInStock: values.quantityInStock,
          unit: values.unit,
          barcode: values.barcode ?? null,
          description: values.description ?? null,
          isActive: values.isActive ?? true,
        });
        reportOnboardingEvent({ type: "product-created" });
      }
      closeForm();
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  function handleDeleteProduct(prod: PublicProduct) {
    setProductToDelete(prod);
  }

  async function confirmDeleteProduct() {
    if (!productToDelete) return;
    setDeletingProduct(true);
    try {
      await deleteProduct(productToDelete.id);
      setProductToDelete(null);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeletingProduct(false);
    }
  }

  async function handleStockAdjust(values: {
    movementType: string;
    quantity: number;
    referenceNote: string;
    expiryDate?: string;
    batchNumber?: string;
  }) {
    if (!stockProduct) return;
    try {
      await adjustStock({
        productId: stockProduct.id,
        movementType: values.movementType,
        quantity: values.quantity,
        referenceNote: values.referenceNote,
        expiryDate: values.expiryDate?.trim() ? values.expiryDate.trim() : null,
        batchNumber: values.batchNumber?.trim() ? values.batchNumber.trim() : null,
      });
      setStockModalOpen(false);
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  if (viewMode === "form") {
    return (
      <ProductFormPage
        initial={editingProduct}
        categories={categories}
        suppliers={suppliers}
        onSave={handleSaveProduct}
        onCancel={closeForm}
        onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
        onSupplierCreated={(sup) => setSuppliers((prev) => [...prev, sup])}
      />
    );
  }

  const totalProducts = products.length;
  const inStockProducts = products.filter((p) => p.quantityInStock >= 10);
  const lowStockCount = products.filter(
    (p) => p.quantityInStock > 0 && p.quantityInStock < 10,
  ).length;
  const outOfStockCount = products.filter((p) => p.quantityInStock <= 0).length;
  const totalValue = products.reduce(
    (sum, p) => sum + p.sellPrice * p.quantityInStock,
    0,
  );

  return (
    <Stack gap="lg">
      {/* Metrics Ribbon */}
      <ProductMetricsRibbon
        totalProducts={totalProducts}
        totalValue={totalValue}
        inStockCount={inStockProducts.length}
        lowStockCount={lowStockCount}
        outOfStockCount={outOfStockCount}
        expiringBatchesCount={expiringBatches.length}
        selectedStatus={selectedStatus}
        onSelectStatus={(status) => {
          setSelectedStatus(status);
          setPage(1);
        }}
      />

      {/* Toolbar & Action Bar */}
      <ProductsToolbar
        totalProducts={totalProducts}
        inStockCount={inStockProducts.length}
        lowStockCount={lowStockCount}
        outOfStockCount={outOfStockCount}
        expiringBatchesCount={expiringBatches.length}
        selectedStatus={selectedStatus}
        onSelectStatus={(status) => {
          setSelectedStatus(status);
          setPage(1);
        }}
        query={query}
        onQueryChange={(q) => {
          setQuery(q);
          setPage(1);
        }}
        selectedCategory={selectedCategory}
        onSelectCategory={(cat) => {
          setSelectedCategory(cat);
          setPage(1);
        }}
        categories={categories}
        onOpenFilterDrawer={() => setFilterDrawerOpen(true)}
        onResetFilters={() => {
          setSelectedCategory("all");
          setSelectedStatus("all");
          setQuery("");
          setPage(1);
        }}
        canManage={perms.canManage}
        canCreate={canCreate}
        onOpenImport={
          onOpenImport
            ? () => {
                onOpenImport();
                reportOnboardingEvent({ type: "wizard-opened" });
              }
            : undefined
        }
        onExportCsv={() => exportProductsToCsv(filtered, categoryMap, supplierMap)}
        onAddProduct={openCreate}
      />

      {/* Slide-Over Filter Drawer */}
      <ProductFilterDrawer
        opened={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        selectedStatus={selectedStatus}
        onSelectStatus={(s) => {
          setSelectedStatus(s);
          setPage(1);
        }}
        selectedCategory={selectedCategory}
        onSelectCategory={(c) => {
          setSelectedCategory(c);
          setPage(1);
        }}
        categories={categories}
        totalProductsCount={totalProducts}
        inStockCount={inStockProducts.length}
        lowStockCount={lowStockCount}
        outOfStockCount={outOfStockCount}
        filteredCount={filtered.length}
        categoryProductCounts={categoryProductCounts}
      />

      {error && (
        <Alert
          color="red"
          variant="light"
          radius="md"
          icon={<AlertTriangle size={16} />}
        >
          {error}
        </Alert>
      )}

      {/* Main Products / Expiring Batches Table */}
      <Box
        style={{
          background: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          borderRadius: 16,
          boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.04)",
          overflow: "hidden",
        }}
      >
        {selectedStatus === "expiring" ? (
          <ExpiringBatchesTable
            batches={expiringBatches}
            onBackToAll={() => setSelectedStatus("all")}
            onWriteOff={(b) => setWriteOffTarget(b)}
          />
        ) : loading ? (
          <Box p={40} ta="center">
            <Text c="dimmed" size="sm">
              Loading inventory catalog…
            </Text>
          </Box>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Package size={20} />}
            title={totalProducts === 0 ? "No products yet" : "No matching products"}
            description={
              totalProducts === 0
                ? "Add your first product or import a spreadsheet to populate the catalog."
                : "Try searching with a different keyword or reset active filters."
            }
          />
        ) : (
          <ProductsTable
            products={paginatedProducts}
            categoryMap={categoryMap}
            supplierMap={supplierMap}
            customFieldDefs={customFieldDefs}
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={openEdit}
            onStock={openStock}
            onMovements={openMovements}
            onBatches={openBatches}
            onDelete={handleDeleteProduct}
          />
        )}

        {!loading && filtered.length > 0 && selectedStatus !== "expiring" && (
          <Box
            p="md"
            style={{
              borderTop: "1px solid var(--app-border)",
              background: "var(--app-soft)",
            }}
          >
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="xs" c="dimmed">
                Showing{" "}
                <strong style={{ color: "var(--app-text)" }}>
                  {(page - 1) * pageSize + 1}
                </strong>{" "}
                –{" "}
                <strong style={{ color: "var(--app-text)" }}>
                  {Math.min(page * pageSize, filtered.length)}
                </strong>{" "}
                out of{" "}
                <strong style={{ color: "var(--app-text)" }}>
                  {filtered.length}
                </strong>{" "}
                products
              </Text>

              {totalPages > 1 && (
                <Pagination
                  total={totalPages}
                  value={page}
                  onChange={setPage}
                  radius="pill"
                  size="sm"
                  color="dark"
                />
              )}
            </Group>
          </Box>
        )}
      </Box>

      {/* Modals */}
      <StockAdjustModal
        opened={stockModalOpen}
        onClose={() => setStockModalOpen(false)}
        onSave={handleStockAdjust}
        product={stockProduct}
        categoryName={
          stockProduct?.categoryId
            ? categoryMap.get(stockProduct.categoryId)
            : undefined
        }
      />

      <MovementsModal
        opened={movementsModalOpen}
        onClose={() => setMovementsModalOpen(false)}
        product={movementsProduct}
      />

      <BatchesModal
        opened={batchesModalOpen}
        onClose={() => setBatchesModalOpen(false)}
        product={batchesProduct}
        onChanged={load}
      />

      <WriteOffModal
        batch={writeOffTarget}
        onClose={() => setWriteOffTarget(null)}
        onWrittenOff={async () => {
          setWriteOffTarget(null);
          await load();
        }}
      />

      <ConfirmDialog
        opened={Boolean(productToDelete)}
        onClose={() => setProductToDelete(null)}
        onConfirm={confirmDeleteProduct}
        title="Delete Product"
        message={
          productToDelete ? (
            <>
              Are you sure you want to delete product{" "}
              <strong>{productToDelete.name}</strong> ({productToDelete.sku})?
            </>
          ) : null
        }
        subtitle="Stock movements and history will be kept, but the product will be archived from active catalog."
        confirmLabel="Delete Product"
        danger
        loading={deletingProduct}
      />
    </Stack>
  );
}
