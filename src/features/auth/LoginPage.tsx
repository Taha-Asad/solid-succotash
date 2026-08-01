// ==========================================
// LOGIN PAGE
// ==========================================
//
// Appears when a company exists but nobody is logged in.
// Collects email + password, calls Rust's login_user command,
// and on success tells the App to switch to the dashboard.

import { useState } from "react";

import {
  //   Anchor,
  Button,
  Container,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import { loginUser, getErrorMessage } from "../../api/backend";
import type { PublicUser } from "../../types/backend";

// ---- Props ----

interface LoginPageProps {
  onLogin: (user: PublicUser) => void;
}

// ---- Component ----

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const user = await loginUser({ email, password });
      onLogin(user);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container size="xs" py="xl">
      <Paper radius="md" p="xl" withBorder>
        <Title order={2} ta="center" mb="xs">
          Sign In
        </Title>
        <Text c="dimmed" size="sm" ta="center" mb="xl">
          Enter your credentials to access the dashboard.
        </Text>

        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <TextInput
              label="Email"
              placeholder="you@company.com"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />

            <PasswordInput
              label="Password"
              placeholder="Your password"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />

            {error && (
              <Text c="red" size="sm">
                {error}
              </Text>
            )}

            <Button type="submit" fullWidth loading={loading} size="md">
              Sign In
            </Button>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
