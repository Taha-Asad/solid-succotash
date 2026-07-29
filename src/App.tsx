import { useState } from "react";
// 1. Import `invoke` securely from Tauri's React/TS API package
import { invoke } from "@tauri-apps/api/core";

// Define a TypeScript interface matching our Rust `PublicUser` struct
interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  company_id: string | null;
}

export default function App() {
  // --- Form State ---
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  // --- UI Feedback State ---
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState<string>("");
  const [isError, setIsError] = useState<boolean>(false);

  // 2. Handle Register Button Click
  const handleRegister = async () => {
    setMessage("Registering...");
    setIsError(false);
    try {
      // Call Rust `register_user` command
      // Notice: React passes camelCase `fullName`, Rust receives snake_case `full_name` automatically!
      const result = await invoke<User>("register_user", {
        email,
        password,
        fullName,
      });
      setUser(result);
      setMessage(`Success! Registered user: ${result.full_name}`);
    } catch (error) {
      setIsError(true);
      setMessage(String(error)); // Display Rust error (e.g., "Email already exists")
    }
  };

  // 3. Handle Login Button Click
  const handleLogin = async () => {
    setMessage("Logging in...");
    setIsError(false);
    try {
      // Call Rust `login_user` command
      const result = await invoke<User>("login_user", {
        email,
        password,
      });
      setUser(result);
      setMessage(`Welcome back, ${result.full_name}! (Role: ${result.role})`);
    } catch (error) {
      setIsError(true);
      setMessage(String(error)); // Display Rust error (e.g., "Invalid email or password")
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl shadow-xl p-8">
        <h1 className="text-2xl font-bold text-blue-400 mb-2">
          ijazandcompany ERP
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          Phase 1: Role-Based Auth Testing
        </p>

        {/* Input: Full Name (Only needed for Register) */}
        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
            Full Name (For Register)
          </label>
          <input
            type="text"
            placeholder="Ijaz Ahmad"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Input: Email */}
        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
            Email Address
          </label>
          <input
            type="email"
            placeholder="ijaz@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Input: Password */}
        <div className="mb-6">
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
            Password
          </label>
          <input
            type="password"
            placeholder="•••••••• text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={handleRegister}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg text-sm transition"
          >
            Register
          </button>
          <button
            onClick={handleLogin}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded-lg text-sm transition"
          >
            Login
          </button>
        </div>

        {/* Status Message Box */}
        {message && (
          <div
            className={`p-3 rounded-lg text-sm font-medium mb-4 ${
              isError
                ? "bg-red-500/10 border border-red-500/30 text-red-400"
                : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
            }`}
          >
            {message}
          </div>
        )}

        {/* Display Logged-in User Info */}
        {user && (
          <div className="p-4 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono">
            <p className="text-slate-400 mb-1 font-sans font-bold">
              Current Session Data (From Rust):
            </p>
            <pre className="overflow-x-auto text-blue-300">
              {JSON.stringify(user, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
