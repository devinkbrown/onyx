module Outbox exposing
    ( ComposerChrome
    , ComposerKind(..)
    , FlushInput
    , FlushTerminal(..)
    , HomeChrome
    , HomeInput
    , Timing
    , Tone(..)
    , autoRetryDelayMs
    , autoRetryLimit
    , composerChrome
    , decideFlushTerminal
    , entryStatusLabel
    , entryTiming
    , homeChrome
    , maxAgeMs
    , maxEntries
    )

{-| Offline outbox decision + status chrome, mirroring the pure oracle
modules `lib/vault/outboxFlushDecision.ts` (terminal flush decision,
auto-retry budget) and `lib/vault/outboxStatus.ts` (composer/Home
labels, row timing). The durable queue itself (IndexedDB rows,
flush walk, labeled-echo admission) stays ports-side with the vault
write path; this module is the shared truth for when a flush is done
and what chrome it earns. UI copy strings are byte-identical to the
oracle so the revamped views cannot drift from the shipped wording.
-}


{-| Auto-retry attempts after the first flush on a connection. -}
autoRetryLimit : Int
autoRetryLimit =
    5


{-| Delay between auto-retry flushes while still connected (ms). -}
autoRetryDelayMs : Int
autoRetryDelayMs =
    4000


{-| Outbox row TTL: 24h (`OUTBOX_MAX_AGE_MS`). -}
maxAgeMs : Float
maxAgeMs =
    24 * 60 * 60 * 1000


{-| Hard bound on durable outbox rows (`OUTBOX_MAX_ENTRIES`). -}
maxEntries : Int
maxEntries =
    100


{-| Clamp a wire/JS-style fractional counter to a non-negative Int,
mirroring `Math.max(0, Math.floor(x))`. -}
floorCount : Float -> Int
floorCount value =
    max 0 (floor value)


{-| Flush-walk terminal input. `maxAutoRetries`/`retryDelayMs`
default to the constants when `Nothing`, mirroring the oracle's
optional overrides. -}
type alias FlushInput =
    { waiting : Float
    , pruneFailed : Float
    , retriesUsed : Float
    , maxAutoRetries : Maybe Float
    , retryDelayMs : Maybe Float
    , connected : Bool
    }


{-| How a flush walk ends. -}
type FlushTerminal
    = ClearFailed
    | Defer
    | ScheduleRetry { nextRetries : Int, delayMs : Int }
    | MarkFailed { deliveryWaiting : Int }


{-| Classify how a flush ends after walking the durable queue:
nothing waiting clears sticky failure chrome; waiting while
disconnected defers without burning budget; connected with budget
left schedules a retry; connected with budget spent marks failure.
-}
decideFlushTerminal : FlushInput -> FlushTerminal
decideFlushTerminal input =
    let
        waiting =
            floorCount input.waiting

        pruneFailed =
            floorCount input.pruneFailed

        retriesUsed =
            floorCount input.retriesUsed

        maxAutoRetries =
            case input.maxAutoRetries of
                Just custom ->
                    floorCount custom

                Nothing ->
                    autoRetryLimit

        delayMs =
            case input.retryDelayMs of
                Just custom ->
                    floorCount custom

                Nothing ->
                    autoRetryDelayMs
    in
    if waiting <= 0 then
        ClearFailed

    else if not input.connected then
        Defer

    else if retriesUsed < maxAutoRetries then
        ScheduleRetry { nextRetries = retriesUsed + 1, delayMs = delayMs }

    else
        MarkFailed { deliveryWaiting = max 0 (waiting - pruneFailed) }


{-| Visual tone for status chips (maps to CSS modifiers). -}
type Tone
    = ToneOffline
    | ToneQueued
    | ToneWarning
    | ToneError


{-| Composer chrome variants. -}
type ComposerKind
    = EmptyOffline
    | QueuedOffline
    | QueuedOnline
    | FailedOnline


{-| Composer status chrome. -}
type alias ComposerChrome =
    { kind : ComposerKind
    , count : Int
    , label : String
    , announcement : String
    , tone : Tone
    , canRetry : Bool
    }


{-| Composer status chrome for device-local outbox state. `Nothing`
only when online and the queue is empty (nothing to show). -}
composerChrome : { connected : Bool, queuedCount : Float, deliveryFailed : Bool } -> Maybe ComposerChrome
composerChrome input =
    let
        count =
            floorCount input.queuedCount

        countPhrase =
            messagePhrase count
    in
    if count <= 0 then
        if not input.connected then
            Just
                { kind = EmptyOffline
                , count = 0
                , label = "Offline · Saved on this device"
                , announcement = "Offline. Messages you send are saved on this device."
                , tone = ToneOffline
                , canRetry = False
                }

        else
            Nothing

    else if not input.connected then
        Just
            { kind = QueuedOffline
            , count = count
            , label = "Saved (" ++ String.fromInt count ++ ") · Sends when you reconnect"
            , announcement = countPhrase ++ " saved on this device. Sends when you reconnect."
            , tone = ToneQueued
            , canRetry = False
            }

    else if input.deliveryFailed then
        Just
            { kind = FailedOnline
            , count = count
            , label = "Retryable (" ++ String.fromInt count ++ ") · Could not send yet"
            , announcement = countPhrase ++ " could not send yet. Retry available after you review."
            , tone = ToneError
            , canRetry = True
            }

    else
        Just
            { kind = QueuedOnline
            , count = count
            , label = "Awaiting send (" ++ String.fromInt count ++ ") · Still waiting"
            , announcement = countPhrase ++ " still queued. Waiting to send."
            , tone = ToneWarning
            , canRetry = True
            }


messagePhrase : Int -> String
messagePhrase count =
    if count == 1 then
        "1 message"

    else
        String.fromInt count ++ " messages"


savedPhrase : Int -> String
savedPhrase count =
    if count == 1 then
        "1 saved message"

    else
        String.fromInt count ++ " saved messages"


{-| Home outbox journal input. -}
type alias HomeInput =
    { connected : Bool
    , queuedCount : Float
    , prunePendingCount : Float
    , uncertainCount : Float
    , deliveryFailed : Bool
    }


{-| Home outbox journal header copy. -}
type alias HomeChrome =
    { title : String
    , detail : String
    , tone : Tone
    , showRetry : Bool
    }


{-| Home outbox journal header copy. -}
homeChrome : HomeInput -> Maybe HomeChrome
homeChrome input =
    let
        count =
            floorCount input.queuedCount

        countPhrase =
            savedPhrase count

        prunePending =
            floorCount input.prunePendingCount

        uncertain =
            floorCount input.uncertainCount
    in
    if count <= 0 then
        Nothing

    else if prunePending > 0 then
        Just
            { title = "Saved messages need review"
            , detail =
                String.fromInt prunePending
                    ++ " sent message"
                    ++ (if prunePending == 1 then
                            ""

                        else
                            "s"
                       )
                    ++ " remain stored on this device. Review is still pending; this does not cancel delivery."
            , tone = ToneWarning
            , showRetry = True
            }

    else if uncertain > 0 then
        Just
            { title = "Delivery is uncertain"
            , detail =
                String.fromInt uncertain
                    ++ " message"
                    ++ (if uncertain == 1 then
                            ""

                        else
                            "s"
                       )
                    ++ " may have reached the connection. They will not be sent again automatically; review before recovering."
            , tone = ToneError
            , showRetry = False
            }

    else if not input.connected then
        Just
            { title = "Saved on this device"
            , detail = countPhrase ++ " will send when you reconnect."
            , tone = ToneQueued
            , showRetry = False
            }

    else if input.deliveryFailed then
        Just
            { title = "Retryable messages"
            , detail = countPhrase ++ " could not be sent yet. Try again only after reviewing the conversation."
            , tone = ToneError
            , showRetry = True
            }

    else
        Just
            { title = "Awaiting send"
            , detail = countPhrase ++ " still waiting. Try sending now if the room is ready."
            , tone = ToneWarning
            , showRetry = True
            }


{-| Age / expiry metadata for a single outbox row (no body text). -}
type alias Timing =
    { ageMs : Float
    , expiresInMs : Float
    , expiringSoon : Bool
    , expired : Bool
    }


{-| Row timing against the 24h TTL; the last 10% of TTL reads
"expiring soon" (inclusive bound, mirroring the oracle). -}
entryTiming : Float -> Float -> Timing
entryTiming queuedAt nowMs =
    let
        ageMs =
            max 0 (nowMs - queuedAt)

        expiresInMs =
            maxAgeMs - ageMs

        expired =
            expiresInMs <= 0

        expiringSoon =
            not expired && expiresInMs <= maxAgeMs * 0.1
    in
    { ageMs = ageMs
    , expiresInMs = expiresInMs
    , expiringSoon = expiringSoon
    , expired = expired
    }


{-| Compact row subtitle — destination-safe, never includes body text. -}
entryStatusLabel : Float -> Float -> String
entryStatusLabel queuedAt nowMs =
    let
        timing =
            entryTiming queuedAt nowMs
    in
    if timing.expired then
        "expired — will be dropped"

    else if timing.expiringSoon then
        "queued · expires soon"

    else
        "queued"
