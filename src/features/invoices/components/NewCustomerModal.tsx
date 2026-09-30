import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { UserPlus } from "lucide-react";
import { createCustomer, getErrorMessage } from "../../../api/backend";
import type { PublicCustomer } from "../../../types/backend";

interface NewCustomerModalProps {
  opened: boolean;
  onClose: () => void;
  onCustomerCreated: (customer: PublicCustomer) => void;
}

export function NewCustomerModal({
  opened,
  onClose,
  onCustomerCreated,
}: NewCustomerModalProps) {
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerModalError, setCustomerModalError] = useState<string | null>(null);

  const newCustomerForm = useForm({
    initialValues: {
      name: "",
      phone: "",
      email: "",
      address: "",
      cnic: "",
      ntn: "",
      strn: "",
      buyerType: "unregistered",
    },
    validate: {
      name: (v) => (v.trim().length === 0 ? "Customer name is required" : null),
    },
  });

  const handleCreateCustomerSubmit = async (values: typeof newCustomerForm.values) => {
    setCustomerModalError(null);
    setCreatingCustomer(true);
    try {
      const created = await createCustomer({
        name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        address: values.address.trim(),
        cnic: values.cnic.trim(),
        ntn: values.ntn.trim(),
        strn: values.strn.trim(),
        buyerType: values.buyerType,
      });
      onCustomerCreated(created);
      onClose();
      newCustomerForm.reset();
      notifications.show({
        title: "Customer Registered",
        message: `${created.name} registered and selected.`,
        color: "teal",
      });
    } catch (err) {
      setCustomerModalError(getErrorMessage(err));
    } finally {
      setCreatingCustomer(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <UserPlus size={18} color="var(--app-accent, #C9952A)" />
          <Text fw={700} size="md">
            Register New Customer
          </Text>
        </Group>
      }
      centered
      radius="md"
    >
      <form onSubmit={newCustomerForm.onSubmit(handleCreateCustomerSubmit)}>
        <Stack gap="sm">
          {customerModalError && (
            <Alert color="red" variant="light" p="xs">
              {customerModalError}
            </Alert>
          )}

          <TextInput
            label="Customer / Business Name"
            placeholder="e.g. Al-Madina Traders"
            required
            {...newCustomerForm.getInputProps("name")}
          />

          <SimpleGrid cols={2}>
            <TextInput
              label="Phone / Mobile"
              placeholder="e.g. 0300-1234567"
              {...newCustomerForm.getInputProps("phone")}
            />
            <TextInput
              label="Email (Optional)"
              placeholder="client@domain.com"
              {...newCustomerForm.getInputProps("email")}
            />
          </SimpleGrid>

          <TextInput
            label="Address / City"
            placeholder="e.g. Shah Alam Market, Lahore"
            {...newCustomerForm.getInputProps("address")}
          />

          <SimpleGrid cols={3}>
            <TextInput
              label="CNIC"
              placeholder="35201-..."
              {...newCustomerForm.getInputProps("cnic")}
            />
            <TextInput
              label="NTN"
              placeholder="7-digit NTN"
              {...newCustomerForm.getInputProps("ntn")}
            />
            <TextInput
              label="STRN"
              placeholder="Sales tax #"
              {...newCustomerForm.getInputProps("strn")}
            />
          </SimpleGrid>

          <Group justify="flex-end" mt="md">
            <Button variant="default" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={creatingCustomer}>
              Save Customer
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
