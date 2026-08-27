import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  BoostApiError,
  getBoostOverview,
  sendMoneyBoost,
  sendPortableHolesBoost,
  type MoneyBoostLimits,
  type SendMoneyInput,
  type SendPortableHolesInput
} from "../api/boosts.js";
import { useAuth } from "../auth/auth-context.js";
import { DocumentTitle } from "../components/DocumentTitle.js";

interface SubmissionMessage {
  tone: "success" | "error";
  text: string;
  requestId?: string;
}

interface PortableHolesConfirmation {
  characterId: string;
  characterName: string;
}

function validateGold(value: string, limits: MoneyBoostLimits | undefined): string | undefined {
  if (!/^\d+$/u.test(value)) {
    return "Enter whole gold using digits only.";
  }
  const gold = Number(value);
  if (!Number.isSafeInteger(gold) || !limits || gold < limits.minimumGold || gold > limits.maximumGoldPerRequest) {
    return limits
      ? `Enter between ${limits.minimumGold.toLocaleString()} and ${limits.maximumGoldPerRequest.toLocaleString()} gold.`
      : "Enter a valid whole-gold amount.";
  }
  return undefined;
}

export function BoostsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const authenticatedSession = auth.session?.authenticated ? auth.session : undefined;
  const username = authenticatedSession?.account.username ?? "";
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [goldText, setGoldText] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState<SubmissionMessage>();
  const [unknownLocked, setUnknownLocked] = useState(false);
  const [portableConfirmation, setPortableConfirmation] = useState<PortableHolesConfirmation>();
  const [portableMessage, setPortableMessage] = useState<SubmissionMessage>();
  const moneySubmissionGuard = useRef(false);
  const portableSubmissionGuard = useRef(false);
  const goldInput = useRef<HTMLInputElement>(null);
  const sendBagsButton = useRef<HTMLButtonElement>(null);
  const confirmBagsButton = useRef<HTMLButtonElement>(null);

  const overviewQuery = useQuery({
    queryKey: ["protected", "boosts", username],
    queryFn: ({ signal }) => getBoostOverview(signal),
    enabled: Boolean(authenticatedSession),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true
  });

  useEffect(() => {
    setSelectedCharacterId("");
    setGoldText("");
    setShowValidation(false);
    setSubmissionMessage(undefined);
    setUnknownLocked(false);
    setPortableConfirmation(undefined);
    setPortableMessage(undefined);
    moneySubmissionGuard.current = false;
    portableSubmissionGuard.current = false;
  }, [username]);

  useEffect(() => {
    const characters = overviewQuery.data?.characters;
    if (!characters) {
      return;
    }
    setSelectedCharacterId((current) =>
      characters.some((character) => character.id === current)
        ? current
        : characters[0]?.id ?? ""
    );
  }, [overviewQuery.data?.characters]);

  useEffect(() => {
    if (overviewQuery.error instanceof BoostApiError && overviewQuery.error.httpStatus === 401) {
      auth.setSignedOut();
    }
  }, [auth, overviewQuery.error]);

  useEffect(() => {
    if (portableConfirmation) {
      confirmBagsButton.current?.focus();
    }
  }, [portableConfirmation]);

  const moneyMutation = useMutation({
    mutationFn: sendMoneyBoost,
    retry: false,
    onSuccess: (result) => {
      moneySubmissionGuard.current = false;
      setGoldText("");
      setShowValidation(false);
      setSubmissionMessage({ tone: "success", text: result.message });
    },
    onError: (error: Error, variables: SendMoneyInput) => {
      moneySubmissionGuard.current = false;
      if (error instanceof BoostApiError && error.httpStatus === 401) {
        auth.setSignedOut();
        return;
      }
      const ambiguous = error instanceof BoostApiError &&
        (error.deliveryStatus === "unknown" || error.deliveryStatus === "pending");
      if (ambiguous) {
        setUnknownLocked(true);
      }
      setSubmissionMessage({
        tone: "error",
        text: error.message,
        requestId: ambiguous ? error.requestId ?? variables.requestId : undefined
      });
      if (error instanceof BoostApiError && error.httpStatus === 409) {
        void queryClient.invalidateQueries({ queryKey: ["protected", "boosts", username] });
      }
    }
  });

  const portableMutation = useMutation({
    mutationFn: sendPortableHolesBoost,
    retry: false,
    onSuccess: (result) => {
      portableSubmissionGuard.current = false;
      setPortableConfirmation(undefined);
      setPortableMessage({ tone: "success", text: result.message });
    },
    onError: (error: Error, variables: SendPortableHolesInput) => {
      portableSubmissionGuard.current = false;
      setPortableConfirmation(undefined);
      if (error instanceof BoostApiError && error.httpStatus === 401) {
        auth.setSignedOut();
        return;
      }
      const ambiguous = error instanceof BoostApiError &&
        (error.deliveryStatus === "unknown" || error.deliveryStatus === "pending");
      setPortableMessage({
        tone: "error",
        text: error.message,
        requestId: ambiguous ? error.requestId ?? variables.requestId : undefined
      });
    }
  });

  const limits = overviewQuery.data?.money;
  const portableHoles = overviewQuery.data?.portableHoles;
  const validationMessage = validateGold(goldText, limits);
  const characters = overviewQuery.data?.characters ?? [];
  const moneyControlsDisabled = moneyMutation.isPending || unknownLocked;
  const canSubmitMoney = Boolean(
    authenticatedSession && limits?.enabled && selectedCharacterId && !validationMessage &&
    !overviewQuery.isPending && !overviewQuery.isError && !moneyControlsDisabled
  );
  const canStartPortableHoles = Boolean(
    authenticatedSession && portableHoles?.enabled && selectedCharacterId &&
    !overviewQuery.isPending && !overviewQuery.isError && !portableMutation.isPending &&
    !portableConfirmation
  );

  function changeCharacter(value: string): void {
    setSelectedCharacterId(value);
    setSubmissionMessage(undefined);
    setPortableConfirmation(undefined);
  }

  function submitMoney(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setShowValidation(true);
    if (!canSubmitMoney || !authenticatedSession || moneySubmissionGuard.current) {
      if (validationMessage) goldInput.current?.focus();
      return;
    }
    moneySubmissionGuard.current = true;
    setSubmissionMessage(undefined);
    moneyMutation.mutate({
      requestId: crypto.randomUUID(),
      characterId: selectedCharacterId,
      gold: Number(goldText),
      csrfToken: authenticatedSession.csrfToken
    });
  }

  function startPortableHolesConfirmation(): void {
    if (!canStartPortableHoles) return;
    const character = characters.find((candidate) => candidate.id === selectedCharacterId);
    if (!character) return;
    setPortableMessage(undefined);
    setPortableConfirmation({ characterId: character.id, characterName: character.name });
  }

  function cancelPortableHolesConfirmation(): void {
    setPortableConfirmation(undefined);
    requestAnimationFrame(() => sendBagsButton.current?.focus());
  }

  function confirmPortableHoles(): void {
    if (!portableConfirmation || !authenticatedSession || portableSubmissionGuard.current) return;
    portableSubmissionGuard.current = true;
    setPortableMessage(undefined);
    portableMutation.mutate({
      requestId: crypto.randomUUID(),
      characterId: portableConfirmation.characterId,
      csrfToken: authenticatedSession.csrfToken
    });
  }

  return (
    <main>
      <DocumentTitle>Boosts | DaBoysZeroth</DocumentTitle>
      <header className="hero"><div>
        <p className="eyebrow">ACCOUNT TOOLS</p><h1>Boosts</h1>
        <p className="lede">Choose one of your characters, then use an available account boost.</p>
      </div></header>

      <section className="panel boost-character-panel" aria-labelledby="boost-character-heading">
        <h2 id="boost-character-heading">Character</h2>
        <label htmlFor="boost-character">Choose a character</label>
        <select id="boost-character" value={selectedCharacterId}
          disabled={overviewQuery.isPending || overviewQuery.isError || characters.length === 0 || moneyMutation.isPending || portableMutation.isPending || unknownLocked}
          onChange={(event) => changeCharacter(event.target.value)}>
          <option value="">Select a character</option>
          {characters.map((character) => <option key={character.id} value={character.id}>
            {character.name} — Level {character.level} {character.class}
          </option>)}
        </select>
        {overviewQuery.isPending && <p className="players-message">Loading your characters...</p>}
        {overviewQuery.isError && <p className="message error">Your characters are temporarily unavailable.</p>}
        {overviewQuery.isSuccess && characters.length === 0 && <p className="players-message">This account does not have any characters yet.</p>}
      </section>

      <div className="boost-card-grid">
        <section className="panel boost-card" aria-labelledby="free-money-heading">
          <h2 id="free-money-heading">Free Money</h2>
          <p>Send whole gold to the selected character through in-game mail.</p>
          {limits && !limits.enabled && <p className="message error" role="status">Free Money is currently disabled.</p>}
          <form onSubmit={submitMoney} noValidate>
            <label htmlFor="boost-gold">Gold amount</label>
            <input ref={goldInput} id="boost-gold" type="text" inputMode="numeric" pattern="[0-9]*"
              autoComplete="off" value={goldText} disabled={moneyControlsDisabled || !limits?.enabled}
              aria-invalid={showValidation && Boolean(validationMessage)}
              aria-describedby={`boost-gold-help${showValidation && validationMessage ? " boost-gold-error" : ""}`}
              onChange={(event) => { setGoldText(event.target.value); setSubmissionMessage(undefined); }}
              onBlur={() => setShowValidation(true)} />
            <p id="boost-gold-help" className="field-help">
              {limits ? `${limits.minimumGold.toLocaleString()}–${limits.maximumGoldPerRequest.toLocaleString()} whole gold per request; up to ${limits.dailyGoldLimit.toLocaleString()} gold and ${limits.dailyRequestLimit} requests per UTC day.` : "Whole gold only."}
            </p>
            {showValidation && validationMessage && <p id="boost-gold-error" className="message error">{validationMessage}</p>}
            <button type="submit" disabled={!canSubmitMoney}>{moneyMutation.isPending ? "Sending gold..." : "Send gold"}</button>
          </form>
          {submissionMessage && <div className={`message ${submissionMessage.tone}`} role="status" aria-live="polite">
            <p>{submissionMessage.text}</p>
            {submissionMessage.requestId && <p>Request ID: <code>{submissionMessage.requestId}</code></p>}
          </div>}
        </section>

        <section className="panel boost-card" aria-labelledby="portable-holes-heading">
          <h2 id="portable-holes-heading">Hole Lotta Storage</h2>
          <p>Running out of room? Mail this character four 24-slot Portable Holes. Send another bundle whenever you need more storage.</p>
          {portableHoles && !portableHoles.enabled && <p className="message error" role="status">This boost is currently unavailable.</p>}
          {!portableConfirmation && <button ref={sendBagsButton} type="button" disabled={!canStartPortableHoles} onClick={startPortableHolesConfirmation}>
            {portableMutation.isPending ? "Sending bags..." : "Send bags"}
          </button>}
          {portableConfirmation && <div className="boost-confirmation" role="group" aria-labelledby="portable-holes-confirmation-heading">
            <h3 id="portable-holes-confirmation-heading">Confirm bag delivery</h3>
            <p>Send four 24-slot Portable Holes to {portableConfirmation.characterName}? This repeatable boost sends one new bundle.</p>
            <div className="boost-confirmation-actions">
              <button ref={confirmBagsButton} type="button" disabled={portableMutation.isPending} onClick={confirmPortableHoles}>
                {portableMutation.isPending ? "Sending bags..." : "Confirm"}
              </button>
              <button type="button" className="secondary" disabled={portableMutation.isPending} onClick={cancelPortableHolesConfirmation}>Cancel</button>
            </div>
          </div>}
          {portableMessage && <div className={`message ${portableMessage.tone}`} role="status" aria-live="polite">
            <p>{portableMessage.text}</p>
            {portableMessage.requestId && <p>Request ID: <code>{portableMessage.requestId}</code></p>}
          </div>}
        </section>
      </div>
    </main>
  );
}
