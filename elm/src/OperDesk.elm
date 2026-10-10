module OperDesk exposing
    ( Desk
    , Field(..)
    , Pending
    , blankDesk
    , categoryLabel
    , eventCategoriesIn
    , eventSeveritiesIn
    , filterEventRows
    , formatWirePreview
    , maxEventFilterLength
    , normalizeEventFilter
    , replayLimits
    , replayWire
    , roleLabel
    , setField
    )

{-| v3/moddesk — the operator desk's local state and pure helpers
(mirroring `shell/OperDesk.tsx`, `shell/OperEventConsole.tsx` and
`lib/moderation/eventFilters.ts`).

The validation and wire mapping stay in `App.planOperAction` (one path
for the desk and the composer's `/broadcast`, `/kill`, …); this module
only holds the drafts, the staged review, and the local Event Spine
filters, so it never imports `App`.

-}

import EventReplay exposing (EventReplayEvent)


{-| A validated operator command staged for review (structurally the
same record as `App.OperDeskCommand`). -}
type alias Pending =
    { command : String
    , params : List String
    , summary : String
    , destructive : Bool
    }


type alias Desk =
    { broadcast : String
    , category : String
    , mask : String
    , killNick : String
    , killReason : String
    , pending : Maybe Pending
    , errors : List String
    , lastSent : Maybe String
    , replayLimit : Int
    , lastReplay : Maybe String
    , filterCategory : String
    , filterSeverity : String
    , filterText : String
    }


type Field
    = Broadcast
    | Category
    | Mask
    | KillNick
    | KillReason
    | FilterCategory
    | FilterSeverity
    | FilterText


blankDesk : Desk
blankDesk =
    { broadcast = ""
    , category = "CONNECT"
    , mask = ""
    , killNick = ""
    , killReason = ""
    , pending = Nothing
    , errors = []
    , lastSent = Nothing
    , replayLimit = 50
    , lastReplay = Nothing
    , filterCategory = ""
    , filterSeverity = ""
    , filterText = ""
    }


{-| Write one draft field. The three console filters normalize on
input (mirroring the oracle `onChange`/`onInput` handlers: category
bounded to 32, severity to 24, text to the default 80). -}
setField : Field -> String -> Desk -> Desk
setField field value desk =
    case field of
        Broadcast ->
            { desk | broadcast = value }

        Category ->
            { desk | category = value }

        Mask ->
            { desk | mask = value }

        KillNick ->
            { desk | killNick = value }

        KillReason ->
            { desk | killReason = value }

        FilterCategory ->
            { desk | filterCategory = normalizeEventFilter 32 value }

        FilterSeverity ->
            { desk | filterSeverity = normalizeEventFilter 24 value }

        FilterText ->
            { desk | filterText = normalizeEventFilter maxEventFilterLength value }


{-| The replay sizes the console offers (mirroring `REPLAY_LIMITS`). -}
replayLimits : List Int
replayLimits =
    [ 25, 50, 100 ]


{-| The exact replay line the console sends, for its disclosure. -}
replayWire : Int -> String
replayWire limit =
    "EVENT " ++ String.join " " (EventReplay.eventReplayJsonParams limit)


{-| Role as words, never a mode letter (mirroring `roleLabel`). -}
roleLabel : Bool -> String
roleLabel isNetworkAdmin =
    if isNetworkAdmin then
        "Network administrator"

    else
        "IRC operator"


{-| `SERVER_LINK` → `Server link` (mirroring `operEventCategoryLabel`). -}
categoryLabel : String -> String
categoryLabel category =
    let
        words =
            String.toLower (String.replace "_" " " category)
    in
    String.toUpper (String.left 1 words) ++ String.dropLeft 1 words


{-| Render the exact wire line a plan will send (mirroring
`formatOperWirePreview`: only a trailing parameter that is empty,
spaced, or colon-led gains the `:` prefix). -}
formatWirePreview : Pending -> String
formatWirePreview command =
    let
        last =
            List.length command.params - 1

        param index value =
            if index == last && (value == "" || String.contains " " value || String.startsWith ":" value) then
                ":" ++ value

            else
                value
    in
    String.join " " (command.command :: List.indexedMap param command.params)


maxEventFilterLength : Int
maxEventFilterLength =
    80


{-| Strip C0/DEL controls, trim, and bound (mirroring
`normalizeEventFilter`). -}
normalizeEventFilter : Int -> String -> String
normalizeEventFilter max value =
    value
        |> String.filter (\c -> Char.toCode c > 0x1F && Char.toCode c /= 0x7F)
        |> String.trim
        |> String.left max


{-| Local-only filter over the structured feed (mirroring
`filterEventReplayRows`: category matches the name or the code,
severity exactly, text anywhere — all case-insensitive; blank
filters pass everything; never a server command). -}
filterEventRows : { category : String, severity : String, text : String } -> List EventReplayEvent -> List EventReplayEvent
filterEventRows filters events =
    let
        category =
            String.toLower (normalizeEventFilter 32 filters.category)

        severity =
            String.toLower (normalizeEventFilter 24 filters.severity)

        needle =
            String.toLower (normalizeEventFilter maxEventFilterLength filters.text)

        keep event =
            if category /= "" && String.toLower event.category /= category && String.toLower event.categoryCode /= category then
                False

            else if severity /= "" && String.toLower event.severity /= severity then
                False

            else if needle == "" then
                True

            else
                String.contains needle
                    (String.toLower (String.join " " [ event.category, event.categoryCode, event.severity, event.origin, event.message ]))
    in
    List.filter keep events


{-| Distinct category codes seen in the feed, sorted (the filter
options). -}
eventCategoriesIn : List EventReplayEvent -> List String
eventCategoriesIn events =
    distinctSorted (List.map .categoryCode events)


{-| Distinct severities seen in the feed, sorted. -}
eventSeveritiesIn : List EventReplayEvent -> List String
eventSeveritiesIn events =
    distinctSorted (List.map .severity events)


distinctSorted : List String -> List String
distinctSorted values =
    values
        |> List.filter (\v -> v /= "")
        |> List.sort
        |> List.foldr
            (\v acc ->
                case acc of
                    top :: _ ->
                        if top == v then
                            acc

                        else
                            v :: acc

                    [] ->
                        [ v ]
            )
            []
