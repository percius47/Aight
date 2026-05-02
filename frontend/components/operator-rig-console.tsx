"use client";

import { keccak256, toBytes } from "viem";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useWriteContract } from "wagmi";

import { gatewayUrl, registryAddress } from "@/lib/config";
import type { OperatorRig, PairingCode, RigStatus } from "@/lib/types";

const baseSepoliaChainId = 84532;
const supportedModels = ["gemma3:1b", "llama3", "llama3.2", "mistral", "deepseek-coder"];
const modalSteps = ["Stake", "Model", "Pair", "Command", "Confirm"];
const commandChecklist = [
  "Downloads and runs the AIGHT rig installer for this operating system.",
  "Checks that Ollama is reachable locally and can serve the selected model.",
  "Starts a Cloudflare Quick Tunnel so the gateway can route buyer requests to this rig.",
  "Claims the one-time pairing code and registers this device fingerprint with your operator wallet.",
  "Starts the heartbeat loop that keeps the rig listed as available while it is online and idle.",
];

const registryAbi = [
  {
    type: "function",
    name: "stakeOperator",
    stateMutability: "payable",
    inputs: [
      { name: "endpointHash", type: "bytes32" },
      { name: "modelHash", type: "bytes32" },
      { name: "hardwareHash", type: "bytes32" },
      { name: "hourlyRateWei", type: "uint96" },
    ],
    outputs: [],
  },
] as const;

const statusStyles: Record<RigStatus, string> = {
  installing: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  idle: "border-[#00FF9D]/40 bg-[#00FF9D]/10 text-[#00FF9D]",
  busy: "border-amber-300/40 bg-amber-300/10 text-amber-200",
  halted: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  offline: "border-zinc-700 bg-zinc-900 text-zinc-500",
  error: "border-red-400/40 bg-red-400/10 text-red-200",
};

export function OperatorRigConsole() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const [demoWalletAddress, setDemoWalletAddress] = useState("");
  const [rigs, setRigs] = useState<OperatorRig[]>([]);
  const [selectedRig, setSelectedRig] = useState<OperatorRig | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rigName, setRigName] = useState("Rig");
  const [model, setModel] = useState("gemma3:1b");
  const [stakeWei, setStakeWei] = useState("1000");
  const [hourlyRateWei, setHourlyRateWei] = useState("1000");
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [hasCopiedInstallerCommand, setHasCopiedInstallerCommand] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const operatorAddress = address ?? normalizeAddress(demoWalletAddress);
  const walletReady = Boolean(operatorAddress);

  const loadRigs = useCallback(async () => {
    if (!operatorAddress) {
      setRigs([]);
      return;
    }

    try {
      const response = await fetch(`${gatewayUrl}/operator/rigs?operator_address=${operatorAddress}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as OperatorRig[];
      setRigs(payload);
    } catch {
      setError("Gateway is not reachable yet.");
    }
  }, [operatorAddress]);

  useEffect(() => {
    void loadRigs();
    const interval = window.setInterval(() => void loadRigs(), 5000);
    return () => window.clearInterval(interval);
  }, [loadRigs]);

  const liveRigs = useMemo(() => rigs.filter((rig) => rig.status !== "halted"), [rigs]);
  const isBaseSepolia = chainId === baseSepoliaChainId;
  const canPair = walletReady;
  const commands = useMemo(() => {
    const code = pairingCode?.pairing_code ?? "AIGHT-123456";
    return {
      windows: `powershell -ExecutionPolicy Bypass -NoProfile -Command "iwr -UseBasicParsing https://raw.githubusercontent.com/percius47/Aight/main/operator/install.ps1 -OutFile $env:TEMP\\aight-install.ps1; & $env:TEMP\\aight-install.ps1 -Pair ${code} -Model ${model}"`,
      mac: `curl -fsSL https://raw.githubusercontent.com/percius47/Aight/main/operator/install.sh | bash -s -- ${code} ${model}`,
      linux: `curl -fsSL https://raw.githubusercontent.com/percius47/Aight/main/operator/install.sh | bash -s -- ${code} ${model}`,
    };
  }, [model, pairingCode?.pairing_code]);

  function openPairModal(): void {
    setError(null);
    setStep(0);
    setPairingCode(null);
    setCopiedCommand(null);
    setHasCopiedInstallerCommand(false);
    setModalOpen(true);
  }

  async function stakeOperator(): Promise<void> {
    if (!address) {
      setError("Connect wallet before staking.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await writeContractAsync({
        address: registryAddress as `0x${string}`,
        abi: registryAbi,
        functionName: "stakeOperator",
        args: [
          keccak256(toBytes(`${address}:${rigName}:endpoint`)),
          keccak256(toBytes(model)),
          keccak256(toBytes(`${rigName}:${model}:hardware`)),
          BigInt(hourlyRateWei),
        ],
        value: BigInt(stakeWei),
      });
      setStep(1);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Operator staking failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createPairingCode(): Promise<void> {
    if (!operatorAddress) {
      setError("Connect wallet before generating a pairing code.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${gatewayUrl}/operator/pairing-codes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operator_address: operatorAddress,
          rig_name: rigName,
          model,
          hourly_rate_wei: Number(hourlyRateWei),
          ttl_minutes: 10,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }

      setPairingCode((await response.json()) as PairingCode);
      setStep(3);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Unable to create pairing code.");
    } finally {
      setBusy(false);
    }
  }

  async function haltRig(rig: OperatorRig): Promise<void> {
    if (!operatorAddress) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${gatewayUrl}/operator/rigs/${rig.rig_id}/halt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator_address: operatorAddress }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await loadRigs();
      setSelectedRig(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Unable to halt rig.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRig(rig: OperatorRig): Promise<void> {
    if (!operatorAddress) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${gatewayUrl}/operator/rigs/${rig.rig_id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator_address: operatorAddress }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await loadRigs();
      setSelectedRig((currentRig) => (currentRig?.rig_id === rig.rig_id ? null : currentRig));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Unable to delete rig.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCommand(label: string, command: string): Promise<void> {
    await navigator.clipboard.writeText(command);
    setCopiedCommand(label);
    setHasCopiedInstallerCommand(true);
    window.setTimeout(() => setCopiedCommand(null), 1600);
  }

  return (
    <div className="grid gap-6">
      <OperatorNavbar
        address={address}
        canPair={canPair}
        chainId={chainId}
        demoWalletAddress={demoWalletAddress}
        isBaseSepolia={isBaseSepolia}
        onPair={openPairModal}
        onDemoWalletChange={setDemoWalletAddress}
        operatorAddress={operatorAddress}
      />

      <LiveRigsSection
        busy={busy}
        onDelete={(rig) => void deleteRig(rig)}
        onDetails={setSelectedRig}
        onHalt={(rig) => void haltRig(rig)}
        rigs={liveRigs}
      />

      {selectedRig ? <RigDetailsPanel onClose={() => setSelectedRig(null)} rig={selectedRig} /> : null}
      {error ? <p className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}

      {modalOpen ? (
        <PairRigModal
          busy={busy}
          canPair={canPair}
          commands={commands}
          copiedCommand={copiedCommand}
          error={error}
          hasCopiedInstallerCommand={hasCopiedInstallerCommand}
          hourlyRateWei={hourlyRateWei}
          isBaseSepolia={isBaseSepolia}
          model={model}
          onClose={() => setModalOpen(false)}
          onCopyCommand={(label, command) => void copyCommand(label, command)}
          onCreatePairingCode={() => void createPairingCode()}
          onModelChange={setModel}
          onRateChange={setHourlyRateWei}
          onRigNameChange={setRigName}
          onStake={() => void stakeOperator()}
          onStakeChange={setStakeWei}
          onStepChange={setStep}
          pairingCode={pairingCode}
          rigName={rigName}
          stakeWei={stakeWei}
          step={step}
        />
      ) : null}
    </div>
  );
}

function OperatorNavbar({
  address,
  canPair,
  chainId,
  demoWalletAddress,
  isBaseSepolia,
  onDemoWalletChange,
  onPair,
  operatorAddress,
}: Readonly<{
  address: string | undefined;
  canPair: boolean;
  chainId: number;
  demoWalletAddress: string;
  isBaseSepolia: boolean;
  onDemoWalletChange: (value: string) => void;
  onPair: () => void;
  operatorAddress: string | undefined;
}>) {
  return (
    <section className="rounded-4xl border border-[#00FF9D]/20 bg-zinc-950/80 p-5 shadow-[0_0_60px_rgba(0,255,157,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#00FF9D]">Operator Console</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Host and monitor your rigs</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
            Connect your operator wallet first, then pair rigs through a step-by-step installer flow.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <InfoTile label="Wallet" value={operatorAddress ?? "Not connected"} />
        <InfoTile label="Network" value={isBaseSepolia ? "Base Sepolia ready" : `Chain ${chainId || "disconnected"}`} />
        <InfoTile label="Registry" value={registryAddress} />
      </div>

      {!address ? (
        <label className="mt-5 grid gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
          Demo wallet override
          <input
            className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-[#00FF9D]/60"
            onChange={(event) => onDemoWalletChange(event.target.value)}
            placeholder="Paste operator public address if MetaMask does not connect"
            value={demoWalletAddress}
          />
        </label>
      ) : null}

      <button
        className="mt-5 rounded-2xl bg-[#00FF9D] px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.16em] text-black disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        disabled={!canPair}
        onClick={onPair}
        type="button"
      >
        Pair new rig
      </button>
    </section>
  );
}

function PairRigModal({
  busy,
  canPair,
  commands,
  copiedCommand,
  error,
  hasCopiedInstallerCommand,
  hourlyRateWei,
  isBaseSepolia,
  model,
  onClose,
  onCopyCommand,
  onCreatePairingCode,
  onModelChange,
  onRateChange,
  onRigNameChange,
  onStake,
  onStakeChange,
  onStepChange,
  pairingCode,
  rigName,
  stakeWei,
  step,
}: Readonly<{
  busy: boolean;
  canPair: boolean;
  commands: Record<"windows" | "mac" | "linux", string>;
  copiedCommand: string | null;
  error: string | null;
  hasCopiedInstallerCommand: boolean;
  hourlyRateWei: string;
  isBaseSepolia: boolean;
  model: string;
  onClose: () => void;
  onCopyCommand: (label: string, command: string) => void;
  onCreatePairingCode: () => void;
  onModelChange: (value: string) => void;
  onRateChange: (value: string) => void;
  onRigNameChange: (value: string) => void;
  onStake: () => void;
  onStakeChange: (value: string) => void;
  onStepChange: (value: number) => void;
  pairingCode: PairingCode | null;
  rigName: string;
  stakeWei: string;
  step: number;
}>) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur">
      <section className="relative max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-4xl border border-[#00FF9D]/30 bg-zinc-950 p-5 shadow-[0_0_80px_rgba(0,255,157,0.16)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[#00FF9D]">Pair new rig</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Rig installer wizard</h2>
          </div>
          <button className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300" onClick={onClose} type="button">
            Cancel
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-5">
          {modalSteps.map((item, index) => (
            <div
              aria-current={index === step ? "step" : undefined}
              className={`rounded-2xl border px-3 py-3 text-left text-xs uppercase tracking-[0.18em] ${
                index === step ? "border-[#00FF9D]/50 bg-[#00FF9D]/10 text-[#00FF9D]" : "border-zinc-800 bg-black/40 text-zinc-500"
              }`}
              key={item}
            >
              {index + 1}. {item}
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-3xl border border-zinc-800 bg-black/40 p-5">
          {step === 0 ? (
            <StakeStep
              busy={busy}
              canPair={canPair}
              hourlyRateWei={hourlyRateWei}
              isBaseSepolia={isBaseSepolia}
              onRateChange={onRateChange}
              onStake={onStake}
              onStakeChange={onStakeChange}
              stakeWei={stakeWei}
            />
          ) : null}
          {step === 1 ? (
            <ModelStep model={model} onModelChange={onModelChange} onNext={() => onStepChange(2)} onRigNameChange={onRigNameChange} rigName={rigName} />
          ) : null}
          {step === 2 ? (
            <PairCodeStep busy={busy} onCreatePairingCode={onCreatePairingCode} pairingCode={pairingCode} />
          ) : null}
          {step === 3 ? (
            <CommandStep
              commands={commands}
              copiedCommand={copiedCommand}
              hasCopiedInstallerCommand={hasCopiedInstallerCommand}
              onCopyCommand={onCopyCommand}
              onNext={() => onStepChange(4)}
              pairingCode={pairingCode}
            />
          ) : null}
          {step === 4 ? <ConfirmStep onClose={onClose} pairingCode={pairingCode} /> : null}
        </div>

        {error ? <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      </section>
    </div>
  );
}

function StakeStep({
  busy,
  canPair,
  hourlyRateWei,
  isBaseSepolia,
  onRateChange,
  onStake,
  onStakeChange,
  stakeWei,
}: Readonly<{
  busy: boolean;
  canPair: boolean;
  hourlyRateWei: string;
  isBaseSepolia: boolean;
  onRateChange: (value: string) => void;
  onStake: () => void;
  onStakeChange: (value: string) => void;
  stakeWei: string;
}>) {
  return (
    <div>
      <h3 className="text-xl font-semibold text-white">Step 1: Stake for this rig</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">Stake on Base Sepolia before pairing this rig.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <TextInput label="Stake amount wei" onChange={onStakeChange} value={stakeWei} />
        <TextInput label="Hourly rate wei" onChange={onRateChange} value={hourlyRateWei} />
      </div>
      <div className="mt-5">
        <button
          className="rounded-2xl bg-[#00FF9D] px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black disabled:bg-zinc-700 disabled:text-zinc-400"
          disabled={busy || !canPair || !isBaseSepolia}
          onClick={onStake}
          type="button"
        >
          Stake on Base Sepolia
        </button>
      </div>
    </div>
  );
}

function ModelStep({
  model,
  onModelChange,
  onNext,
  onRigNameChange,
  rigName,
}: Readonly<{
  model: string;
  onModelChange: (value: string) => void;
  onNext: () => void;
  onRigNameChange: (value: string) => void;
  rigName: string;
}>) {
  return (
    <div>
      <h3 className="text-xl font-semibold text-white">Step 2: Select rig model</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">Pick the Ollama model this rig can serve. The command will verify Ollama and pull/check this model.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <TextInput label="Rig label" onChange={onRigNameChange} value={rigName} />
        <label className="grid gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
          Ollama model
          <select
            className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-[#00FF9D]/60"
            onChange={(event) => onModelChange(event.target.value)}
            value={model}
          >
            {supportedModels.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="mt-5 rounded-2xl bg-[#00FF9D] px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black" onClick={onNext} type="button">
        Continue
      </button>
    </div>
  );
}

function PairCodeStep({ busy, onCreatePairingCode, pairingCode }: Readonly<{ busy: boolean; onCreatePairingCode: () => void; pairingCode: PairingCode | null }>) {
  return (
    <div>
      <h3 className="text-xl font-semibold text-white">Step 3: Generate pairing code</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">The code links this wallet, selected model, and target rig setup.</p>
      <button
        className="mt-5 rounded-2xl bg-[#00FF9D] px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black disabled:bg-zinc-700 disabled:text-zinc-400"
        disabled={busy}
        onClick={onCreatePairingCode}
        type="button"
      >
        {pairingCode ? "Regenerate code" : "Generate code"}
      </button>
      {pairingCode ? <p className="mt-5 font-mono text-3xl font-bold text-white">{pairingCode.pairing_code}</p> : null}
    </div>
  );
}

function CommandStep({
  commands,
  copiedCommand,
  hasCopiedInstallerCommand,
  onCopyCommand,
  onNext,
  pairingCode,
}: Readonly<{
  commands: Record<"windows" | "mac" | "linux", string>;
  copiedCommand: string | null;
  hasCopiedInstallerCommand: boolean;
  onCopyCommand: (label: string, command: string) => void;
  onNext: () => void;
  pairingCode: PairingCode | null;
}>) {
  if (!pairingCode) {
    return <p className="text-sm text-zinc-400">Generate a pairing code before copying commands.</p>;
  }
  return (
    <div>
      <h3 className="text-xl font-semibold text-white">Step 4: Run command on rig</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Run this on the machine you want to list. The command prepares the rig, verifies the local inference runtime, connects it to AIGHT, and keeps it discoverable while the terminal stays online.
      </p>
      <ul className="mt-4 grid gap-2 rounded-2xl border border-zinc-800 bg-black/35 p-4 text-sm leading-6 text-zinc-300">
        {commandChecklist.map((item) => (
          <li className="flex gap-3" key={item}>
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#00FF9D]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 grid gap-4">
        {Object.entries(commands).map(([label, command]) => (
          <CommandCard command={command} copied={copiedCommand === label} key={label} label={label} onCopy={() => onCopyCommand(label, command)} />
        ))}
      </div>
      {hasCopiedInstallerCommand ? (
        <button
          className="sticky bottom-0 ml-auto mt-5 block rounded-2xl bg-[#00FF9D] px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black shadow-[0_0_34px_rgba(0,255,157,0.28)]"
          onClick={onNext}
          type="button"
        >
          Next: Confirm heartbeat
        </button>
      ) : null}
    </div>
  );
}

function ConfirmStep({ onClose, pairingCode }: Readonly<{ onClose: () => void; pairingCode: PairingCode | null }>) {
  return (
    <div>
      <h3 className="text-xl font-semibold text-white">Step 5: Confirm heartbeat</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Keep the rig terminal running. When it claims {pairingCode?.pairing_code ?? "the code"}, the live rigs grid will update automatically.
      </p>
      <button className="mt-5 rounded-2xl bg-[#00FF9D] px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-black" onClick={onClose} type="button">
        Done
      </button>
    </div>
  );
}

function LiveRigsSection({
  busy,
  onDelete,
  onDetails,
  onHalt,
  rigs,
}: Readonly<{
  busy: boolean;
  onDelete: (rig: OperatorRig) => void;
  onDetails: (rig: OperatorRig) => void;
  onHalt: (rig: OperatorRig) => void;
  rigs: OperatorRig[];
}>) {
  return (
    <section className="rounded-4xl border border-zinc-800 bg-zinc-950/75 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Live rigs</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Active operator hardware</h2>
        </div>
        <span className="rounded-full border border-[#00FF9D]/30 px-3 py-1 text-xs text-[#00FF9D]">{rigs.length} live</span>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rigs.length > 0 ? (
          rigs.map((rig) => (
            <RigCard
              busy={busy}
              key={rig.rig_id}
              onDelete={() => onDelete(rig)}
              onDetails={() => onDetails(rig)}
              onHalt={() => onHalt(rig)}
              rig={rig}
            />
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-zinc-800 bg-black/30 p-5 text-sm text-zinc-500">No live rigs yet. Connect wallet and pair a rig to start hosting.</div>
        )}
      </div>
    </section>
  );
}

function RigCard({
  busy,
  onDelete,
  onDetails,
  onHalt,
  rig,
}: Readonly<{ busy: boolean; onDelete: () => void; onDetails: () => void; onHalt: () => void; rig: OperatorRig }>) {
  const canDelete = rig.status === "offline" || rig.status === "error" || rig.status === "halted";

  return (
    <article className="rounded-3xl border border-zinc-800 bg-black/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{rig.rig_name}</p>
          <p className="mt-1 break-all font-mono text-xs text-zinc-500">{rig.ens_name || rig.rig_identity}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] ${statusStyles[rig.status]}`}>{rig.status}</span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        <InfoTile label="Model" value={rig.model} />
        <InfoTile label="Latency" value={`${rig.latency_ms}ms`} />
        <InfoTile label="Earn" value={`${rig.expected_earnings_wei} wei`} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-full border border-[#00FF9D]/30 px-3 py-1 text-xs text-[#00FF9D]" onClick={onDetails} type="button">
          Details
        </button>
        <button className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 disabled:text-zinc-600" disabled={busy} onClick={onHalt} type="button">
          Halt
        </button>
        {canDelete ? (
          <button className="rounded-full border border-red-400/40 px-3 py-1 text-xs text-red-200 disabled:text-zinc-600" disabled={busy} onClick={onDelete} type="button">
            Delete
          </button>
        ) : null}
      </div>
    </article>
  );
}

function RigDetailsPanel({ onClose, rig }: Readonly<{ onClose: () => void; rig: OperatorRig }>) {
  return (
    <section className="rounded-4xl border border-[#00FF9D]/20 bg-zinc-950/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[#00FF9D]">Rig details</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{rig.ens_name || rig.rig_identity}</h2>
        </div>
        <button className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <InfoTile label="Status" value={rig.status} />
        <InfoTile label="Model" value={rig.model} />
        <InfoTile label="Load" value={`${Math.round(rig.current_load * 100)}%`} />
        <InfoTile label="Last beat" value={formatTime(rig.last_heartbeat_at)} />
      </div>
      <div className="mt-4 rounded-3xl border border-zinc-800 bg-black/40 p-4 text-sm leading-6 text-zinc-400">
        <p>Assignment: {rig.assignment ? JSON.stringify(rig.assignment) : "No active buyer assignment"}</p>
        <p>Expected earnings: {rig.expected_earnings_wei} wei</p>
        <p>Device fingerprint: {rig.device_fingerprint}</p>
      </div>
    </section>
  );
}

function CommandCard({ command, copied, label, onCopy }: Readonly<{ command: string; copied: boolean; label: string; onCopy: () => void }>) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{label}</p>
        <button className="rounded-full border border-[#00FF9D]/30 px-3 py-1 text-xs text-[#00FF9D]" onClick={onCopy} type="button">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-3 break-all rounded-2xl bg-black/60 p-3 font-mono text-xs leading-5 text-zinc-300">{command}</p>
    </div>
  );
}

function TextInput({ label, onChange, value }: Readonly<{ label: string; onChange: (value: string) => void; value: string }>) {
  return (
    <label className="grid gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
      {label}
      <input
        className="rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-[#00FF9D]/60"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function InfoTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-black/40 p-3">
      <p className="text-[0.65rem] uppercase tracking-[0.25em] text-zinc-600">{label}</p>
      <p className="mt-2 break-all text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function normalizeAddress(value: string): `0x${string}` | undefined {
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? (trimmed.toLowerCase() as `0x${string}`) : undefined;
}
