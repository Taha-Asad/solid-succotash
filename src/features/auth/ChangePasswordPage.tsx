// ==========================================
// CHANGE PASSWORD PAGE — forced first-login flow
// ==========================================
// Shown when mustChangePassword = true. Blocks all navigation until
// the user sets a new password. Matches the login page card styling.

import { useState } from "react";
import { motion } from "framer-motion";

import {
  Alert,
  Button,
  Card,
  Center,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";

import { Lock, ArrowRight, ShieldCheck } from "lucide-react";

import { changeMyPassword, getErrorMessage } from "../../api/backend";
import type { PublicUser } from "../../types/backend";
import { INK } from "../../theme";

interface ChangePasswordPageProps {
  user: PublicUser;
  onComplete: (updatedUser: PublicUser) => void;
}

export default function ChangePasswordPage({
  user,
  onComplete,
}: ChangePasswordPageProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword === currentPassword) {
      setError("New password must be different from the current password.");
      return;
    }

    setLoading(true);

    try {
      await changeMyPassword(currentPassword, newPassword);
      onComplete({ ...user, mustChangePassword: false });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Center
      h="100vh"
      style={{
        background: `linear-gradient(140deg, #0E1530 0%, #16214A 50%, #23315F 100%)`,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        style={{ width: "100%", maxWidth: 420, padding: "0 20px" }}
      >
        <Card withBorder shadow="lg" p="xl">
          <Stack align="center" gap="xs" mb="lg">
            <motion.div
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 14,
                delay: 0.1,
              }}
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
                color: "#131C39",
                marginBottom: 8,
              }}
            >
              <ShieldCheck size={22} />
            </motion.div>
            <Text
              size="xs"
              fw={700}
              style={{
                color: INK.gold,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              First Login
            </Text>
            <Text fw={800} size="xl" style={{ color: INK.text }}>
              Set Your New Password
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              For security, please change the temporary password that was
              assigned to your account.
            </Text>
          </Stack>

          <Alert color="blue" variant="light" mb="md">
            <Text size="xs">
              Signed in as <strong>{user.email}</strong>
            </Text>
          </Alert>

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <TextInput
                label="Current Password"
                placeholder="Enter current password"
                type="password"
                required
                size="md"
                leftSection={<Lock size={16} />}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.currentTarget.value)}
              />

              <TextInput
                label="New Password"
                placeholder="Enter new password (min 8 characters)"
                type="password"
                required
                size="md"
                leftSection={<Lock size={16} />}
                value={newPassword}
                onChange={(e) => setNewPassword(e.currentTarget.value)}
              />

              <TextInput
                label="Confirm New Password"
                placeholder="Re-enter new password"
                type="password"
                required
                size="md"
                leftSection={<Lock size={16} />}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              />

              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}

              <motion.div whileTap={{ scale: 0.98 }}>
                <Button
                  type="submit"
                  fullWidth
                  loading={loading}
                  size="md"
                  rightSection={!loading && <ArrowRight size={16} />}
                  disabled={!currentPassword || !newPassword || !confirmPassword}
                  styles={{
                    root: {
                      background:
                        "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
                      color: "#131C39",
                      fontWeight: 700,
                      height: 46,
                      "&:hover": { filter: "brightness(1.05)" },
                    },
                  }}
                >
                  Set New Password
                </Button>
              </motion.div>
            </Stack>
          </form>
        </Card>
      </motion.div>
    </Center>
  );
}
