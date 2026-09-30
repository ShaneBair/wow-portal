import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  BoostApiError,
  getBoostOverview,
  getItemDeliveryPreview,
  sendArcaneTomeBoost,
  sendCharacterLevelBoost,
  sendMoneyBoost,
  sendPortableHolesBoost,
  sendItemDelivery,
  type MoneyBoostLimits,
  type BoostOverview,
  type SendArcaneTomeInput,
  type SendCharacterLevelInput,
  type SendItemDeliveryInput,
  type SendMoneyInput,
  type SendPortableHolesInput,
  type ItemDeliveryPreview
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

interface CharacterLevelConfirmation extends PortableHolesConfirmation {
  currentLevel: number;
  targetLevel: number;
}

interface ItemDeliveryConfirmation extends PortableHolesConfirmation {
  item: ItemDeliveryPreview;
  quantity: number;
}

function parseDigits(value: string, maximum: number): number | undefined {
  if (!/^[1-9]\d*$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined;
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
  const [tomeConfirmation, setTomeConfirmation] = useState<PortableHolesConfirmation>();
  const [tomeMessage, setTomeMessage] = useState<SubmissionMessage>();
  const [targetLevel, setTargetLevel] = useState(2);
  const [levelConfirmation, setLevelConfirmation] = useState<CharacterLevelConfirmation>();
  const [levelMessage, setLevelMessage] = useState<SubmissionMessage>();
  const [itemIdText, setItemIdText] = useState("");
  const [quantityText, setQuantityText] = useState("1");
  const [itemLookupId, setItemLookupId] = useState<number>();
  const [showItemValidation, setShowItemValidation] = useState(false);
  const [itemConfirmation, setItemConfirmation] = useState<ItemDeliveryConfirmation>();
  const [itemMessage, setItemMessage] = useState<SubmissionMessage>();
  const [itemUnknownLocked, setItemUnknownLocked] = useState(false);
  const moneySubmissionGuard = useRef(false);
  const portableSubmissionGuard = useRef(false);
  const tomeSubmissionGuard = useRef(false);
  const levelSubmissionGuard = useRef(false);
  const itemSubmissionGuard = useRef(false);
  const goldInput = useRef<HTMLInputElement>(null);
  const sendBagsButton = useRef<HTMLButtonElement>(null);
  const confirmBagsButton = useRef<HTMLButtonElement>(null);
  const sendTomeButton = useRef<HTMLButtonElement>(null);
  const raiseLevelButton = useRef<HTMLButtonElement>(null);
  const sendItemButton = useRef<HTMLButtonElement>(null);

  const overviewQuery = useQuery({
    queryKey: ["protected", "boosts", username],
    queryFn: ({ signal }) => getBoostOverview(signal),
    enabled: Boolean(authenticatedSession),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true
  });

  const configuredItemMaximum = overviewQuery.data?.itemDelivery.maximumQuantity ?? 0;
  const parsedItemId = parseDigits(itemIdText, 0xffff_ffff);

  useEffect(() => {
    if (parsedItemId === undefined || !overviewQuery.data?.itemDelivery.enabled || itemUnknownLocked) {
      setItemLookupId(undefined);
      return;
    }
    const timeout = window.setTimeout(() => setItemLookupId(parsedItemId), 300);
    return () => window.clearTimeout(timeout);
  }, [itemIdText, itemUnknownLocked, overviewQuery.data?.itemDelivery.enabled, parsedItemId]);

  const itemLookupQuery = useQuery({
    queryKey: ["protected", "boosts", "item", username, itemLookupId],
    queryFn: ({ signal }) => getItemDeliveryPreview(itemLookupId!, signal),
    enabled: Boolean(authenticatedSession && itemLookupId),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    setSelectedCharacterId("");
    setGoldText("");
    setShowValidation(false);
    setSubmissionMessage(undefined);
    setUnknownLocked(false);
    setPortableConfirmation(undefined);
    setPortableMessage(undefined);
    setTomeConfirmation(undefined);
    setTomeMessage(undefined);
    setTargetLevel(2);
    setLevelConfirmation(undefined);
    setLevelMessage(undefined);
    setItemIdText("");
    setQuantityText("1");
    setItemLookupId(undefined);
    setShowItemValidation(false);
    setItemConfirmation(undefined);
    setItemMessage(undefined);
    setItemUnknownLocked(false);
    moneySubmissionGuard.current = false;
    portableSubmissionGuard.current = false;
    tomeSubmissionGuard.current = false;
    levelSubmissionGuard.current = false;
    itemSubmissionGuard.current = false;
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

  const selectedCharacter = overviewQuery.data?.characters.find(
    (character) => character.id === selectedCharacterId
  );

  useEffect(() => {
    if (selectedCharacter) {
      setTargetLevel(Math.min(selectedCharacter.level + 1, 80));
    }
  }, [selectedCharacter?.id, selectedCharacter?.level]);

  useEffect(() => {
    if (overviewQuery.error instanceof BoostApiError && overviewQuery.error.httpStatus === 401) {
      auth.setSignedOut();
    }
    if (itemLookupQuery.error instanceof BoostApiError && itemLookupQuery.error.httpStatus === 401) {
      auth.setSignedOut();
    }
  }, [auth, itemLookupQuery.error, overviewQuery.error]);

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

  const tomeMutation = useMutation({
    mutationFn: sendArcaneTomeBoost,
    retry: false,
    onSuccess: (result) => {
      tomeSubmissionGuard.current = false;
      setTomeConfirmation(undefined);
      setTomeMessage({ tone: "success", text: result.message });
    },
    onError: (error: Error, variables: SendArcaneTomeInput) => {
      tomeSubmissionGuard.current = false;
      setTomeConfirmation(undefined);
      if (error instanceof BoostApiError && error.httpStatus === 401) {
        auth.setSignedOut();
        return;
      }
      const ambiguous = error instanceof BoostApiError &&
        (error.deliveryStatus === "unknown" || error.deliveryStatus === "pending");
      setTomeMessage({
        tone: "error",
        text: error.message,
        requestId: ambiguous ? error.requestId ?? variables.requestId : undefined
      });
    }
  });

  const levelMutation = useMutation({
    mutationFn: sendCharacterLevelBoost,
    retry: false,
    onSuccess: (result) => {
      levelSubmissionGuard.current = false;
      setLevelConfirmation(undefined);
      setLevelMessage({ tone: "success", text: result.message });
      queryClient.setQueryData<BoostOverview>(["protected", "boosts", username], (current) => current ? {
        ...current,
        characters: current.characters.map((character) =>
          character.id === result.character.id ? { ...character, level: result.character.level } : character
        )
      } : current);
    },
    onError: (error: Error, variables: SendCharacterLevelInput) => {
      levelSubmissionGuard.current = false;
      setLevelConfirmation(undefined);
      if (error instanceof BoostApiError && error.httpStatus === 401) {
        auth.setSignedOut();
        return;
      }
      const ambiguous = error instanceof BoostApiError &&
        (error.deliveryStatus === "unknown" || error.deliveryStatus === "pending");
      setLevelMessage({
        tone: "error",
        text: error.message,
        requestId: ambiguous ? error.requestId ?? variables.requestId : undefined
      });
      if (error instanceof BoostApiError && error.httpStatus === 409) {
        void queryClient.invalidateQueries({ queryKey: ["protected", "boosts", username] });
      }
    }
  });

  const itemMutation = useMutation({
    mutationFn: sendItemDelivery,
    retry: false,
    onSuccess: (result) => {
      itemSubmissionGuard.current = false;
      setItemConfirmation(undefined);
      setItemMessage({ tone: "success", text: result.message });
    },
    onError: (error: Error, variables: SendItemDeliveryInput) => {
      itemSubmissionGuard.current = false;
      setItemConfirmation(undefined);
      if (error instanceof BoostApiError && error.httpStatus === 401) {
        auth.setSignedOut();
        return;
      }
      const ambiguous = error instanceof BoostApiError &&
        (error.deliveryStatus === "unknown" || error.deliveryStatus === "pending");
      if (ambiguous) setItemUnknownLocked(true);
      setItemMessage({
        tone: "error",
        text: error.message,
        requestId: ambiguous ? error.requestId ?? variables.requestId : undefined
      });
    }
  });

  const limits = overviewQuery.data?.money;
  const portableHoles = overviewQuery.data?.portableHoles;
  const arcaneTome = overviewQuery.data?.arcaneTome;
  const characterLevel = overviewQuery.data?.characterLevel;
  const itemDelivery = overviewQuery.data?.itemDelivery;
  const validationMessage = validateGold(goldText, limits);
  const characters = overviewQuery.data?.characters ?? [];
  const moneyControlsDisabled = moneyMutation.isPending || unknownLocked;
  const currentItem = itemLookupQuery.data?.id === parsedItemId ? itemLookupQuery.data : undefined;
  const lookupMatchesInput = itemLookupId === parsedItemId;
  const parsedQuantity = parseDigits(quantityText, currentItem?.maximumQuantity ?? configuredItemMaximum);
  const itemIdValidation = itemIdText.length === 0
    ? "Enter an item ID."
    : parsedItemId === undefined ? "Enter a whole item ID using digits only." : undefined;
  const quantityValidation = quantityText.length === 0
    ? "Enter a quantity."
    : parsedQuantity === undefined
      ? `Enter a whole quantity from 1 through ${(currentItem?.maximumQuantity ?? configuredItemMaximum).toLocaleString()}.`
      : undefined;
  const itemControlsDisabled = itemMutation.isPending || itemUnknownLocked || !itemDelivery?.enabled;
  const canSubmitMoney = Boolean(
    authenticatedSession && limits?.enabled && selectedCharacterId && !validationMessage &&
    !overviewQuery.isPending && !overviewQuery.isError && !moneyControlsDisabled
  );
  const canStartPortableHoles = Boolean(
    authenticatedSession && portableHoles?.enabled && selectedCharacterId &&
    !overviewQuery.isPending && !overviewQuery.isError && !portableMutation.isPending &&
    !portableConfirmation
  );
  const canStartArcaneTome = Boolean(
    authenticatedSession && arcaneTome?.enabled && selectedCharacterId &&
    !overviewQuery.isPending && !overviewQuery.isError && !tomeMutation.isPending &&
    !tomeConfirmation
  );
  const canStartCharacterLevel = Boolean(
    authenticatedSession && characterLevel?.enabled && selectedCharacter &&
    selectedCharacter.level < characterLevel.maximumLevel && targetLevel > selectedCharacter.level &&
    targetLevel <= characterLevel.maximumLevel && !overviewQuery.isPending && !overviewQuery.isError &&
    !levelMutation.isPending && !levelConfirmation
  );
  const canStartItemDelivery = Boolean(
    authenticatedSession && selectedCharacter && currentItem && parsedQuantity &&
    !itemIdValidation && !quantityValidation && !itemControlsDisabled &&
    !itemLookupQuery.isPending && !itemConfirmation
  );

  function changeCharacter(value: string): void {
    setSelectedCharacterId(value);
    setSubmissionMessage(undefined);
    setPortableConfirmation(undefined);
    setTomeConfirmation(undefined);
    setLevelConfirmation(undefined);
    setItemConfirmation(undefined);
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

  function startArcaneTomeConfirmation(): void {
    if (!canStartArcaneTome) return;
    const character = characters.find((candidate) => candidate.id === selectedCharacterId);
    if (!character) return;
    setTomeMessage(undefined);
    setTomeConfirmation({ characterId: character.id, characterName: character.name });
  }

  function cancelArcaneTomeConfirmation(): void {
    setTomeConfirmation(undefined);
    requestAnimationFrame(() => sendTomeButton.current?.focus());
  }

  function confirmArcaneTome(): void {
    if (!tomeConfirmation || !authenticatedSession || tomeSubmissionGuard.current) return;
    tomeSubmissionGuard.current = true;
    setTomeMessage(undefined);
    tomeMutation.mutate({
      requestId: crypto.randomUUID(),
      characterId: tomeConfirmation.characterId,
      csrfToken: authenticatedSession.csrfToken
    });
  }

  function startLevelConfirmation(): void {
    if (!canStartCharacterLevel || !selectedCharacter) return;
    setLevelMessage(undefined);
    setLevelConfirmation({
      characterId: selectedCharacter.id,
      characterName: selectedCharacter.name,
      currentLevel: selectedCharacter.level,
      targetLevel
    });
  }

  function cancelLevelConfirmation(): void {
    setLevelConfirmation(undefined);
    requestAnimationFrame(() => raiseLevelButton.current?.focus());
  }

  function confirmCharacterLevel(): void {
    if (!levelConfirmation || !authenticatedSession || levelSubmissionGuard.current) return;
    levelSubmissionGuard.current = true;
    setLevelMessage(undefined);
    levelMutation.mutate({
      requestId: crypto.randomUUID(),
      characterId: levelConfirmation.characterId,
      targetLevel: levelConfirmation.targetLevel,
      csrfToken: authenticatedSession.csrfToken
    });
  }

  function changeItemId(value: string): void {
    setItemIdText(value);
    setQuantityText("1");
    setShowItemValidation(false);
    setItemConfirmation(undefined);
    if (!itemUnknownLocked) setItemMessage(undefined);
  }

  function startItemConfirmation(): void {
    setShowItemValidation(true);
    if (!canStartItemDelivery || !selectedCharacter || !currentItem || !parsedQuantity) return;
    setItemMessage(undefined);
    setItemConfirmation({
      characterId: selectedCharacter.id,
      characterName: selectedCharacter.name,
      item: currentItem,
      quantity: parsedQuantity
    });
  }

  function cancelItemConfirmation(): void {
    setItemConfirmation(undefined);
    requestAnimationFrame(() => sendItemButton.current?.focus());
  }

  function confirmItemDelivery(): void {
    if (!itemConfirmation || !authenticatedSession || itemSubmissionGuard.current) return;
    itemSubmissionGuard.current = true;
    setItemMessage(undefined);
    itemMutation.mutate({
      requestId: crypto.randomUUID(),
      characterId: itemConfirmation.characterId,
      itemId: itemConfirmation.item.id,
      quantity: itemConfirmation.quantity,
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
          disabled={overviewQuery.isPending || overviewQuery.isError || characters.length === 0 || moneyMutation.isPending || portableMutation.isPending || tomeMutation.isPending || levelMutation.isPending || itemMutation.isPending || unknownLocked}
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

        <section className="panel boost-card" aria-labelledby="item-delivery-heading">
          <h2 id="item-delivery-heading">Item Delivery Service</h2>
          <p>Choose an item template and mail it to this character, whether they are online or offline.</p>
          {itemDelivery && !itemDelivery.enabled && <p className="message error" role="status">This boost is currently unavailable.</p>}
          <label htmlFor="boost-item-id">Item ID</label>
          <input id="boost-item-id" type="text" inputMode="numeric" pattern="[0-9]*"
            autoComplete="off" value={itemIdText} disabled={itemControlsDisabled}
            aria-invalid={showItemValidation && Boolean(itemIdValidation)}
            aria-describedby={`boost-item-id-help${showItemValidation && itemIdValidation ? " boost-item-id-error" : ""}`}
            onChange={(event) => changeItemId(event.target.value)}
            onBlur={() => setShowItemValidation(true)} />
          <p id="boost-item-id-help" className="field-help">Enter the numeric WotLK item entry.</p>
          {showItemValidation && itemIdValidation && <p id="boost-item-id-error" className="message error">{itemIdValidation}</p>}
          <div className="item-lookup-status" role="status" aria-live="polite">
            {lookupMatchesInput && itemLookupQuery.isPending && itemLookupId && <p>Looking up item...</p>}
            {currentItem && <p>Item found: <strong>{currentItem.name}</strong> (item {currentItem.id}).</p>}
            {lookupMatchesInput && itemLookupQuery.isError && <p className="message error">{itemLookupQuery.error.message}</p>}
          </div>
          <label htmlFor="boost-item-quantity">Quantity</label>
          <input id="boost-item-quantity" type="text" inputMode="numeric" pattern="[0-9]*"
            autoComplete="off" value={quantityText} disabled={itemControlsDisabled || !currentItem}
            aria-invalid={showItemValidation && Boolean(quantityValidation)}
            aria-describedby={`boost-item-quantity-help${showItemValidation && quantityValidation ? " boost-item-quantity-error" : ""}`}
            onChange={(event) => { setQuantityText(event.target.value); setItemConfirmation(undefined); if (!itemUnknownLocked) setItemMessage(undefined); }}
            onBlur={() => setShowItemValidation(true)} />
          <p id="boost-item-quantity-help" className="field-help">
            {currentItem
              ? `Maximum ${currentItem.maximumQuantity.toLocaleString()} for this item.`
              : `Maximum ${configuredItemMaximum.toLocaleString()} before item-specific limits.`}
          </p>
          {showItemValidation && quantityValidation && <p id="boost-item-quantity-error" className="message error">{quantityValidation}</p>}
          {!itemConfirmation && <button ref={sendItemButton} type="button" disabled={!canStartItemDelivery} onClick={startItemConfirmation}>
            {itemMutation.isPending ? "Sending item..." : "Send item"}
          </button>}
          {itemConfirmation && <div className="boost-confirmation" role="group" aria-labelledby="item-delivery-confirmation-heading">
            <h3 id="item-delivery-confirmation-heading">Confirm item delivery</h3>
            <p>Send {itemConfirmation.quantity} × {itemConfirmation.item.name} (item {itemConfirmation.item.id}) to {itemConfirmation.characterName} by in-game mail?</p>
            <div className="boost-confirmation-actions">
              <button type="button" disabled={itemMutation.isPending} onClick={confirmItemDelivery}>
                {itemMutation.isPending ? "Sending item..." : "Confirm item delivery"}
              </button>
              <button type="button" className="secondary" disabled={itemMutation.isPending} onClick={cancelItemConfirmation}>Cancel</button>
            </div>
          </div>}
          {itemMessage && <div className={`message ${itemMessage.tone}`} role="status" aria-live="polite">
            <p>{itemMessage.text}</p>
            {itemMessage.requestId && <p>Request ID: <code>{itemMessage.requestId}</code></p>}
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

        <section className="panel boost-card" aria-labelledby="arcane-tome-heading">
          <h2 id="arcane-tome-heading">Tomeward Bound</h2>
          <p>Mail the selected character a reusable Arcane Tome of Displacement that opens the server&apos;s configured travel menu.</p>
          <p className="field-help"><strong>Unique:</strong> each character can own only one at a time.</p>
          {arcaneTome && !arcaneTome.enabled && <p className="message error" role="status">This boost is currently unavailable.</p>}
          {!tomeConfirmation && <button ref={sendTomeButton} type="button" disabled={!canStartArcaneTome} onClick={startArcaneTomeConfirmation}>
            {tomeMutation.isPending ? "Sending tome..." : "Send tome"}
          </button>}
          {tomeConfirmation && <div className="boost-confirmation" role="group" aria-labelledby="arcane-tome-confirmation-heading">
            <h3 id="arcane-tome-confirmation-heading">Confirm tome delivery</h3>
            <p>Send one Arcane Tome of Displacement to {tomeConfirmation.characterName} by in-game mail?</p>
            <div className="boost-confirmation-actions">
              <button type="button" disabled={tomeMutation.isPending} onClick={confirmArcaneTome}>
                {tomeMutation.isPending ? "Sending tome..." : "Confirm"}
              </button>
              <button type="button" className="secondary" disabled={tomeMutation.isPending} onClick={cancelArcaneTomeConfirmation}>Cancel</button>
            </div>
          </div>}
          {tomeMessage && <div className={`message ${tomeMessage.tone}`} role="status" aria-live="polite">
            <p>{tomeMessage.text}</p>
            {tomeMessage.requestId && <p>Request ID: <code>{tomeMessage.requestId}</code></p>}
          </div>}
        </section>

        <section className="panel boost-card" aria-labelledby="character-level-heading">
          <h2 id="character-level-heading">Level Up, Buttercup</h2>
          <p>Raise this character to any level up to 80, even while they are offline.</p>
          {characterLevel && !characterLevel.enabled && <p className="message error" role="status">This boost is currently unavailable.</p>}
          {selectedCharacter && <p>Current level: <strong>{selectedCharacter.level}</strong></p>}
          {selectedCharacter && selectedCharacter.level >= 80
            ? <p className="players-message">This character is already at the maximum level.</p>
            : selectedCharacter && <>
              <label htmlFor="boost-target-level">Target level</label>
              <input
                id="boost-target-level"
                type="range"
                min={selectedCharacter.level + 1}
                max={characterLevel?.maximumLevel ?? 80}
                step={1}
                value={targetLevel}
                disabled={!characterLevel?.enabled || levelMutation.isPending}
                aria-describedby="boost-level-target-text boost-level-xp-warning"
                onChange={(event) => {
                  setTargetLevel(Number(event.target.value));
                  setLevelConfirmation(undefined);
                }}
              />
              <p id="boost-level-target-text">Target level: <strong>{targetLevel}</strong></p>
              <p id="boost-level-xp-warning" className="field-help">Your current experience progress will reset when the level changes.</p>
              {!levelConfirmation && <button ref={raiseLevelButton} type="button" disabled={!canStartCharacterLevel} onClick={startLevelConfirmation}>
                {levelMutation.isPending ? "Raising level..." : "Raise level"}
              </button>}
            </>}
          {levelConfirmation && <div className="boost-confirmation" role="group" aria-labelledby="character-level-confirmation-heading">
            <h3 id="character-level-confirmation-heading">Confirm level boost</h3>
            <p>Raise {levelConfirmation.characterName} from level {levelConfirmation.currentLevel} to level {levelConfirmation.targetLevel}? Current experience progress will reset.</p>
            <div className="boost-confirmation-actions">
              <button type="button" disabled={levelMutation.isPending} onClick={confirmCharacterLevel}>
                {levelMutation.isPending ? "Raising level..." : "Confirm level boost"}
              </button>
              <button type="button" className="secondary" disabled={levelMutation.isPending} onClick={cancelLevelConfirmation}>Cancel</button>
            </div>
          </div>}
          {levelMessage && <div className={`message ${levelMessage.tone}`} role="status" aria-live="polite">
            <p>{levelMessage.text}</p>
            {levelMessage.requestId && <p>Request ID: <code>{levelMessage.requestId}</code></p>}
          </div>}
        </section>
      </div>
    </main>
  );
}
