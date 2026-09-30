import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { getErrorMessage } from "../../../api/backend";
import { getCurrencyCode, paisaToNumber } from "../../../utils/currency";
import type {
  CurrencyConfig,
  PublicInvoiceItem,
  PublicProduct,
} from "../../../types/backend";
import {
  computeLinePreview,
  displayToPaisa,
  paisaToDisplay,
} from "../utils/invoiceHelpers";

interface AddItemModalProps {
  opened: boolean;
  onClose: () => void;
  onAdd: (values: {
    productId: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discountType: string;
    discountValue: number;
  }) => Promise<void>;
  onUpdate: (
    values: {
      productId: string;
      quantity: number;
      unitPrice: number;
      taxRate: number;
      discountType: string;
      discountValue: number;
    },
    itemId: string,
  ) => Promise<void>;
  editingItem: PublicInvoiceItem | null;
  products: PublicProduct[];
  currencyConfig?: CurrencyConfig | null;
}

export function AddItemModal({
  opened,
  onClose,
  onAdd,
  onUpdate,
  editingItem,
  products,
  currencyConfig,
}: AddItemModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = editingItem !== null;

  const form = useForm({
    initialValues: {
      productId: "",
      quantity: 1,
      unitPrice: 0,
      taxRate: 0,
      discountType: "percent" as string,
      discountValue: 0,
    },
    validate: {
      productId: (v) => (v ? null : "Select a product"),
      quantity: (v) => (v > 0 ? null : "Must be > 0"),
    },
  });

  // Populate the form when opening in edit mode
  useEffect(() => {
    if (opened && editingItem) {
      form.setValues({
        productId: editingItem.productId,
        quantity: editingItem.quantity,
        unitPrice: paisaToNumber(editingItem.unitPrice, currencyConfig),
        taxRate: editingItem.taxRate / 100,
        discountType:
          editingItem.discountType === "amount" ? "amount" : "percent",
        discountValue:
          editingItem.discountType === "amount"
            ? paisaToNumber(editingItem.discountAmount, currencyConfig)
            : editingItem.discountRate / 100,
      });
    } else if (opened) {
      form.reset();
    }
  }, [opened, editingItem, currencyConfig]);

  // Auto-fill price when product changes
  function handleProductChange(productId: string) {
    form.setFieldValue("productId", productId);
    const product = products.find((p) => p.id === productId);
    if (product) {
      form.setFieldValue(
        "unitPrice",
        paisaToNumber(product.sellPrice, currencyConfig),
      );
      form.setFieldValue("taxRate", product.taxRate / 100);
    }
  }

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    const payload = {
      productId: values.productId,
      quantity: values.quantity,
      unitPrice: displayToPaisa(values.unitPrice, currencyConfig),
      taxRate: Math.round(values.taxRate * 100),
      discountType: values.discountType,
      discountValue:
        values.discountType === "amount"
          ? displayToPaisa(values.discountValue, currencyConfig)
          : Math.round(values.discountValue * 100),
    };

    try {
      if (isEdit && editingItem) {
        await onUpdate(payload, editingItem.id);
      } else {
        await onAdd(payload);
      }
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const productOptions = products
    .filter((p) => p.isActive)
    .map((p) => ({
      value: p.id,
      label: `${p.name} (${p.sku}) — Stock: ${p.quantityInStock}`,
    }));

  const preview = computeLinePreview({
    quantity: form.values.quantity,
    unitPricePaisa: displayToPaisa(form.values.unitPrice, currencyConfig),
    taxRateBp: Math.round(form.values.taxRate * 100),
    discountType: form.values.discountType,
    discountValue:
      form.values.discountType === "amount"
        ? displayToPaisa(form.values.discountValue, currencyConfig)
        : Math.round(form.values.discountValue * 100),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? "Edit Item" : "Add Item"}
      centered
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Select
            label="Product"
            placeholder="Select product"
            data={productOptions}
            required
            searchable
            disabled={isEdit}
            value={form.values.productId}
            onChange={(v) => v && handleProductChange(v)}
          />

          <SimpleGrid cols={2}>
            <NumberInput
              label="Quantity"
              min={1}
              required
              {...form.getInputProps("quantity")}
            />
            <NumberInput
              label="Unit Price"
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...form.getInputProps("unitPrice")}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <NumberInput
              label="Tax Rate %"
              decimalScale={2}
              fixedDecimalScale
              suffix="%"
              min={0}
              max={100}
              {...form.getInputProps("taxRate")}
            />
            <Select
              label="Discount Type"
              data={[
                { value: "percent", label: "Percentage (%)" },
                { value: "amount", label: "Fixed Amount (Rs)" },
              ]}
              {...form.getInputProps("discountType")}
            />
          </SimpleGrid>

          <NumberInput
            label={
              form.values.discountType === "amount"
                ? "Discount Amount (Rs)"
                : "Discount %"
            }
            placeholder={
              form.values.discountType === "amount" ? "e.g. 500" : "e.g. 10"
            }
            decimalScale={2}
            fixedDecimalScale
            suffix={form.values.discountType === "percent" ? "%" : ""}
            min={0}
            {...form.getInputProps("discountValue")}
          />

          {/* Preview */}
          {preview.subtotal > 0 && (
            <Alert color="blue" variant="light">
              <Text size="sm">
                Line total:{" "}
                <Text span fw={700}>
                  {paisaToDisplay(preview.total, currencyConfig)}{" "}
                  {getCurrencyCode(currencyConfig)}
                </Text>{" "}
                (Subtotal {paisaToDisplay(preview.subtotal, currencyConfig)} −
                Discount {paisaToDisplay(preview.discount, currencyConfig)} +
                Tax {paisaToDisplay(preview.tax, currencyConfig)}, rounded to
                nearest rupee)
              </Text>
            </Alert>
          )}

          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {isEdit ? "Save Changes" : "Add Item"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
