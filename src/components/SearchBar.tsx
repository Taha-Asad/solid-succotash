// ==========================================
// GLOBAL SEARCH BAR (FTS5)
// ==========================================
// Debounced live search across products & customers.
// Groups results by type in a popover, styled with
// the INK navy/gold tokens used across the app.

import { useEffect, useRef, useState } from "react";

import {
  Box,
  Group,
  Kbd,
  Loader,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";

import { Package, Search, SearchX, UserRound } from "lucide-react";

import { searchAll } from "../api/backend";
import type { SearchResult } from "../api/backend";
import { INK } from "../theme";

interface SearchBarProps {
  onSelect: (result: SearchResult) => void;
}

export default function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(async () => {
      try {
        const res = await searchAll(query.trim());
        setResults(res);
        setOpened(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [query]);

  const products = results.filter((r) => r.resultType === "product");
  const customers = results.filter((r) => r.resultType === "customer");
  const empty = !loading && results.length === 0 && query.trim().length > 0;

  function handleSelect(result: SearchResult) {
    setQuery("");
    setResults([]);
    setOpened(false);
    onSelect(result);
  }

  return (
    <Popover
      opened={opened && query.trim().length > 0}
      onChange={setOpened}
      width={420}
      position="bottom-start"
      shadow="lg"
      withArrow
      styles={{ dropdown: { padding: 0, overflow: "hidden" } }}
    >
      <Popover.Target>
        <TextInput
          leftSection={<Search size={16} style={{ color: INK.muted }} />}
          rightSection={
            loading ? (
              <Loader size={14} color={INK.gold} />
            ) : query.trim() ? (
              <Kbd size="xs">esc</Kbd>
            ) : undefined
          }
          placeholder="Search products, customers..."
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            if (!e.currentTarget.value.trim()) setOpened(false);
          }}
          onFocus={() => {
            if (query.trim() && results.length > 0) setOpened(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              setResults([]);
              setOpened(false);
            }
          }}
          w={320}
          size="sm"
          radius="md"
          styles={{
            input: {
              background: "#fff",
              border: `1px solid ${INK.border}`,
              "&:focus": {
                borderColor: INK.gold,
                boxShadow: `0 0 0 1px ${INK.gold}`,
              },
            },
          }}
        />
      </Popover.Target>

      <Popover.Dropdown>
        {loading ? (
          <Group justify="center" py="xl">
            <Loader size={20} color={INK.gold} />
          </Group>
        ) : empty ? (
          <Stack align="center" py="xl" gap="xs">
            <ThemeIcon
              variant="light"
              color="gray"
              radius="xl"
              size="xl"
              style={{ background: "#EEF2FA" }}
            >
              <SearchX size={22} style={{ color: INK.muted }} />
            </ThemeIcon>
            <Text size="sm" fw={600} c="dimmed">
              No results for "{query.trim()}"
            </Text>
            <Text size="xs" c="dimmed">
              Try a product name, SKU, or customer name.
            </Text>
          </Stack>
        ) : (
          <ScrollArea.Autosize mah={360} type="scroll">
            <Stack gap={4} p={6}>
              {products.length > 0 && (
                <ResultGroup
                  label="Products"
                  icon={<Package size={13} />}
                  items={products}
                  onSelect={handleSelect}
                />
              )}
              {customers.length > 0 && (
                <ResultGroup
                  label="Customers"
                  icon={<UserRound size={13} />}
                  items={customers}
                  onSelect={handleSelect}
                />
              )}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

function ResultGroup({
  label,
  icon,
  items,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  items: SearchResult[];
  onSelect: (result: SearchResult) => void;
}) {
  return (
    <Box>
      <Group gap={6} px="xs" py={6}>
        <span style={{ color: INK.gold }}>{icon}</span>
        <Text
          size="xs"
          fw={800}
          style={{ color: INK.navy, letterSpacing: 1.2, textTransform: "uppercase" }}
        >
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {items.length}
        </Text>
      </Group>
      <Stack gap={2}>
        {items.map((item) => (
          <Box
            key={`${item.resultType}:${item.id}`}
            onClick={() => onSelect(item)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 10,
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#EEF2FA")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <ThemeIcon
              size="sm"
              radius="md"
              variant="light"
              color={item.resultType === "product" ? "brand" : "gold"}
            >
              {item.resultType === "product" ? (
                <Package size={14} />
              ) : (
                <UserRound size={14} />
              )}
            </ThemeIcon>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={600} style={{ color: INK.navy }} lineClamp={1}>
                {item.name}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {item.subtitle}
              </Text>
            </Box>
            <Text size="xs" c="dimmed" style={{ textAlign: "right" }} lineClamp={1}>
              {item.detail}
            </Text>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
