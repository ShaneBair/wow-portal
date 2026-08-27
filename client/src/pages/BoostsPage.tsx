import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  BoostApiError,
  getBoostOverview,
  sendMoneyBoost,
  type MoneyBoostLimits,
  type SendMoneyInput
} from "../api/boosts.js";
import { useAuth } from "../auth/auth-context.js";
import { DocumentTitle } from "../components/DocumentTitle.js";

interface SubmissionMessage {
  tone: "success" | "error";
  text: string;
  requestId?: string;
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
  const submissionGuard = useRef(false);
  const goldInput = useRef<HTMLInputElement>(null);

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
    submissionGuard.current = false;
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

  const mutation = useMutation({
    mutationFn: sendMoneyBoost,
    retry: false,
    onSuccess: (result) => {
      submissionGuard.current = false;
      setGoldText("");
      setShowValidation(false);
      setSubmissionMessage({ tone: "success", text: result.message });
    },
    onError: (error: Error, variables: SendMoneyInput) => {
      submissionGuard.current = false;
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

  const limits = overviewQuery.data?.money;
  const validationMessage = validateGold(goldText, limits);
  const characters = overviewQuery.data?.characters ?? [];
  const controlsDisabled = mutation.isPending || unknownLocked;
  const canSubmit = Boolean(
    authenticatedSession &&
    limits?.enabled &&
    selectedCharacterId &&
    !validationMessage &&
    !overviewQuery.isPending &&
    !overviewQuery.isError &&
    !controlsDisabled
  );

  function changeCharacter(value: string): void {
    setSelectedCharacterId(value);
    setSubmissionMessage(undefined);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setShowValidation(true);
    if (!canSubmit || !authenticatedSession || submissionGuard.current) {
      if (validationMessage) {
        goldInput.current?.focus();
      }
      return;
    }
    submissionGuard.current = true;
    setSubmissionMessage(undefined);
    mutation.mutate({
      requestId: crypto.randomUUID(),
      characterId: selectedCharacterId,
      gold: Number(goldText),
      csrfToken: authenticatedSession.csrfToken
    });
  }

  return (
    <main>
      <DocumentTitle>Boosts | DaBoysZeroth</DocumentTitle>
      <header className="hero">
        <div>
          <p className="eyebrow">ACCOUNT TOOLS</p>
          <h1>Boosts</h1>
          <p className="lede">Choose one of your characters, then use an available account boost.</p>
        </div>
      </header>

      <section className="panel boost-character-panel" aria-labelledby="boost-character-heading">
        <h2 id="boost-character-heading">Character</h2>
        <label htmlFor="boost-character">Choose a character</label>
        <select
          id="boost-character"
          value={selectedCharacterId}
          disabled={overviewQuery.isPending || overviewQuery.isError || characters.length === 0 || controlsDisabled}
          onChange={(event) => changeCharacter(event.target.value)}
        >
          <option value="">Select a character</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name} — Level {character.level} {character.class}
            </option>
          ))}
        </select>
        {overviewQuery.isPending && <p className="players-message">Loading your characters...</p>}
        {overviewQuery.isError && <p className="message error">Your characters are temporarily unavailable.</p>}
        {overviewQuery.isSuccess && characters.length === 0 && (
          <p className="players-message">This account does not have any characters yet.</p>
        )}
      </section>

      <div className="boost-card-grid">
        <section className="panel boost-card" aria-labelledby="free-money-heading">
          <h2 id="free-money-heading">Free Money</h2>
          <p>Send whole gold to the selected character through in-game mail.</p>
          {limits && !limits.enabled && (
            <p className="message error" role="status">Free Money is currently disabled.</p>
          )}
          <form onSubmit={submit} noValidate>
            <label htmlFor="boost-gold">Gold amount</label>
            <input
              ref={goldInput}
              id="boost-gold"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={goldText}
              disabled={controlsDisabled || !limits?.enabled}
              aria-invalid={showValidation && Boolean(validationMessage)}
              aria-describedby={`boost-gold-help${showValidation && validationMessage ? " boost-gold-error" : ""}`}
              onChange={(event) => {
                setGoldText(event.target.value);
                setSubmissionMessage(undefined);
              }}
              onBlur={() => setShowValidation(true)}
            />
            <p id="boost-gold-help" className="field-help">
              {limits
                ? `${limits.minimumGold.toLocaleString()}–${limits.maximumGoldPerRequest.toLocaleString()} whole gold per request; up to ${limits.dailyGoldLimit.toLocaleString()} gold and ${limits.dailyRequestLimit} requests per UTC day.`
                : "Whole gold only."}
            </p>
            {showValidation && validationMessage && (
              <p id="boost-gold-error" className="message error">{validationMessage}</p>
            )}
            <button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? "Sending gold..." : "Send gold"}
            </button>
          </form>
          {submissionMessage && (
            <div className={`message ${submissionMessage.tone}`} role="status" aria-live="polite">
              <p>{submissionMessage.text}</p>
              {submissionMessage.requestId && (
                <p>Request ID: <code>{submissionMessage.requestId}</code></p>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
