module HistoryImport exposing
    ( Batch
    , Conversation
    , Ctx
    , Dest
    , Effect(..)
    , Msg(..)
    , Phase(..)
    , Plan
    , Row
    , Source(..)
    , Staged
    , State
    , Status
    , blank
    , busy
    , countLabel
    , decodeBatches
    , decodeStaged
    , destFor
    , destinationError
    , fingerprint
    , formatDay
    , fromVaultSnapshot
    , groupThousands
    , isDestinationRoom
    , maxConversations
    , maxRowsPerConversation
    , maxTotalRows
    , normalizeDestination
    , ownerChanged
    , plan
    , progressPercent
    , removeButtonId
    , removeConfirmId
    , reviewTitleId
    , sourceFromKey
    , sourceInfo
    , sourceKey
    , statusId
    , sources
    , update
    )

{-| v3/gap-import — third-party history import (roadmap 4.5) and the
staged review for the portable vault file (parity rows V45–V57).

The heavy lifting (picking, reading, decompressing, parsing) runs in a
Web Worker owned by `historyImport.js`; this module owns everything
after the parse:

  - a strict decoder for the staged payload (`decodeStaged`) — every
    row is re-validated against the vault bounds (`VaultImport`), so
    the port is never trusted;
  - the review state: per-conversation include + destination mapping
    (`normalizeDestination`: a `#room` or a person's nick), counts of
    new / already-here / skipped rows, and the confirm `plan` that
    turns the review into vault writes (only new rows, grouped by
    destination, chunked) plus a removable batch ledger;
  - cancel (the worker is terminated), owner-change abort
    (`ownerChanged`), and remove / undo of a past import batch.

`update` never touches `App.Model`: it returns `Effect`s that `App`
interprets — `Persist` goes through ONE App function onto the existing
`VaultPersist` port, so vault owner scoping lands in one place.

Fixes over the SolidJS oracle (`shell/HistoryImportControls.tsx`):
the room for a plain log is picked in the review rather than before
parsing; any conversation can be remapped or left out; rows already in
the vault are counted and never re-written; and an import can be undone.

-}

import Bitwise
import Dict exposing (Dict)
import DmCipher
import GroupEnvelope
import Json.Decode as Decode
import Set exposing (Set)
import Time
import VaultImport



-- SOURCES


type Source
    = Discord
    | DiscordPackage
    | Slack
    | IrcLog
    | Portable


{-| The third-party sources, in picker order (the portable vault has its
own card). -}
sources : List Source
sources =
    [ Discord, DiscordPackage, Slack, IrcLog ]


sourceKey : Source -> String
sourceKey source =
    case source of
        Discord ->
            "discord"

        DiscordPackage ->
            "discord-package"

        Slack ->
            "slack"

        IrcLog ->
            "irc"

        Portable ->
            "portable"


sourceFromKey : String -> Maybe Source
sourceFromKey key =
    case key of
        "discord" ->
            Just Discord

        "discord-package" ->
            Just DiscordPackage

        "slack" ->
            Just Slack

        "irc" ->
            Just IrcLog

        "portable" ->
            Just Portable

        _ ->
            Nothing


type alias SourceInfo =
    { title : String
    , short : String
    , blurb : String
    , choose : String
    , folder : Bool
    }


sourceInfo : Source -> SourceInfo
sourceInfo source =
    case source of
        Discord ->
            { title = "Discord export"
            , short = "Discord"
            , blurb = "Export rooms with DiscordChatExporter in JSON mode, then choose the .json files. Several files (or pages of one room) can go in together."
            , choose = "Choose Discord JSON files"
            , folder = False
            }

        DiscordPackage ->
            { title = "Discord data package"
            , short = "Discord package"
            , blurb = "Discord → Settings → Privacy & Safety → Request all of my Data. Unzip the package, then choose its folder. It holds only your own messages."
            , choose = "Choose package folder"
            , folder = True
            }

        Slack ->
            { title = "Slack export"
            , short = "Slack"
            , blurb = "Download your workspace export from Slack's admin settings, unzip it, then choose the folder (users.json plus one folder per channel)."
            , choose = "Choose export folder"
            , folder = True
            }

        IrcLog ->
            { title = "IRC client logs"
            , short = "IRC logs"
            , blurb = "Plain-text logs from WeeChat, irssi, mIRC, ZNC or HexChat. Choose one or more files; you pick the room in the review."
            , choose = "Choose log files"
            , folder = False
            }

        Portable ->
            { title = "Onyx vault file"
            , short = "Onyx vault"
            , blurb = "A portable vault exported from Onyx (.json or .json.gz)."
            , choose = "Import vault file"
            , folder = False
            }



-- STAGED PAYLOAD


{-| One validated row, already in vault-row terms. `print` is the
ports-side content fingerprint (ledger + duplicate check); `dup` marks
a row the vault already holds (same id or same fingerprint). -}
type alias Row =
    { id : String
    , from : String
    , body : String
    , at : Int
    , rowType : String
    , print : String
    , dup : Bool
    , replyTo : Maybe { id : String, from : String, text : String }
    }


type alias Conversation =
    { key : String
    , source : String
    , suggested : String
    , dm : Bool
    , rows : List Row
    , count : Int
    , dupCount : Int
    , oldest : Int
    , newest : Int
    }


type alias Staged =
    { job : Int
    , source : Source
    , label : String
    , files : Int
    , rejectedFiles : Int
    , skipped : Int
    , systemSkipped : Int
    , duplicatesInFile : Int
    , droppedOverCap : Int
    , overBudget : Int
    , datesEstimated : Bool
    , invalid : Int
    , conversations : List Conversation
    }


maxConversations : Int
maxConversations =
    VaultImport.maxExportTargets


maxRowsPerConversation : Int
maxRowsPerConversation =
    VaultImport.maxExportRawMessages


maxTotalRows : Int
maxTotalRows =
    VaultImport.maxExportTotalRawMessages


maxReplyText : Int
maxReplyText =
    300


maxLabel : Int
maxLabel =
    160


{-| Strict decode of `historyImportStaged { job, result }`. `Nothing`
when the envelope is malformed or no row survives validation. Rows
that fail any bound are dropped and counted in `invalid`. -}
decodeStaged : Decode.Value -> Maybe Staged
decodeStaged value =
    case Decode.decodeValue envelopeDecoder value of
        Err _ ->
            Nothing

        Ok raw ->
            let
                strict =
                    raw.source /= Portable

                ( conversations, invalid, _ ) =
                    List.foldl (foldConversation strict) ( [], 0, maxTotalRows ) (List.take maxConversations raw.conversations)

                kept =
                    List.reverse conversations
            in
            if List.isEmpty kept then
                Nothing

            else
                Just
                    { job = raw.job
                    , source = raw.source
                    , label = cleanLabel raw.label
                    , files = nonNegative raw.files
                    , rejectedFiles = nonNegative raw.rejectedFiles
                    , skipped = nonNegative raw.skipped
                    , systemSkipped = nonNegative raw.systemSkipped
                    , duplicatesInFile = nonNegative raw.duplicatesInFile
                    , droppedOverCap = nonNegative raw.droppedOverCap
                    , overBudget = nonNegative raw.overBudget
                    , datesEstimated = raw.datesEstimated
                    , invalid = invalid
                    , conversations = kept
                    }


type alias RawEnvelope =
    { job : Int
    , source : Source
    , label : String
    , files : Int
    , rejectedFiles : Int
    , skipped : Int
    , systemSkipped : Int
    , duplicatesInFile : Int
    , droppedOverCap : Int
    , overBudget : Int
    , datesEstimated : Bool
    , conversations : List Decode.Value
    }


type alias RawConversation =
    { key : String
    , source : String
    , suggested : String
    , dm : Bool
    , rows : List Decode.Value
    }


intOr0 : String -> Decode.Decoder Int
intOr0 field =
    Decode.oneOf [ Decode.field field Decode.int, Decode.succeed 0 ]


envelopeDecoder : Decode.Decoder RawEnvelope
envelopeDecoder =
    Decode.map2 (\job result -> { result | job = job })
        (Decode.field "job" Decode.int)
        (Decode.field "result"
            (Decode.succeed RawEnvelope
                |> andMap (Decode.succeed 0)
                |> andMap
                    (Decode.field "kind" Decode.string
                        |> Decode.andThen
                            (\k ->
                                case sourceFromKey k of
                                    Just s ->
                                        Decode.succeed s

                                    Nothing ->
                                        Decode.fail "kind"
                            )
                    )
                |> andMap (Decode.oneOf [ Decode.field "label" Decode.string, Decode.succeed "" ])
                |> andMap (intOr0 "files")
                |> andMap (intOr0 "rejectedFiles")
                |> andMap (intOr0 "skipped")
                |> andMap (intOr0 "systemSkipped")
                |> andMap (intOr0 "duplicatesInFile")
                |> andMap (intOr0 "droppedOverCap")
                |> andMap (intOr0 "overBudget")
                |> andMap (Decode.oneOf [ Decode.field "datesEstimated" Decode.bool, Decode.succeed False ])
                |> andMap (Decode.field "conversations" (Decode.list Decode.value))
            )
        )


andMap : Decode.Decoder a -> Decode.Decoder (a -> b) -> Decode.Decoder b
andMap =
    Decode.map2 (|>)


conversationDecoder : Decode.Decoder RawConversation
conversationDecoder =
    Decode.map5 RawConversation
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "source" Decode.string, Decode.succeed "" ])
        (Decode.oneOf [ Decode.field "suggested" Decode.string, Decode.succeed "" ])
        (Decode.oneOf [ Decode.field "dm" Decode.bool, Decode.succeed False ])
        (Decode.field "rows" (Decode.list Decode.value))


type alias RawRow =
    { id : String
    , from : String
    , text : String
    , rowType : String
    , time : Float
    , print : String
    , dup : Bool
    , replyTo : Maybe { id : String, from : String, text : String }
    }


rowDecoder : Decode.Decoder RawRow
rowDecoder =
    Decode.succeed RawRow
        |> andMap (Decode.field "id" Decode.string)
        |> andMap (Decode.field "from" Decode.string)
        |> andMap (Decode.field "text" Decode.string)
        |> andMap (Decode.oneOf [ Decode.field "type" Decode.string, Decode.succeed "" ])
        |> andMap (Decode.field "time" Decode.float)
        |> andMap (Decode.oneOf [ Decode.field "print" Decode.string, Decode.succeed "" ])
        |> andMap (Decode.oneOf [ Decode.field "dup" Decode.bool, Decode.succeed False ])
        |> andMap
            (Decode.oneOf
                [ Decode.field "replyTo"
                    (Decode.nullable
                        (Decode.map3 (\i f t -> { id = i, from = f, text = t })
                            (Decode.field "id" Decode.string)
                            (Decode.field "from" Decode.string)
                            (Decode.field "text" Decode.string)
                        )
                    )
                , Decode.succeed Nothing
                ]
            )


foldConversation : Bool -> Decode.Value -> ( List Conversation, Int, Int ) -> ( List Conversation, Int, Int )
foldConversation strict value ( done, invalid, budget ) =
    if budget <= 0 then
        ( done, invalid, budget )

    else
        case Decode.decodeValue conversationDecoder value of
            Err _ ->
                ( done, invalid + 1, budget )

            Ok raw ->
                if String.isEmpty raw.key || String.length raw.key > 256 || List.any (\c -> c.key == raw.key) done then
                    ( done, invalid + List.length raw.rows, budget )

                else
                    let
                        tail =
                            List.drop (List.length raw.rows - min maxRowsPerConversation budget) raw.rows

                        ( rows, bad ) =
                            List.foldr
                                (\rowValue ( acc, n ) ->
                                    case Decode.decodeValue rowDecoder rowValue |> Result.toMaybe |> Maybe.andThen (validRow strict) of
                                        Just row ->
                                            ( row :: acc, n )

                                        Nothing ->
                                            ( acc, n + 1 )
                                )
                                ( [], 0 )
                                tail

                        unique =
                            dedupe rows

                        dropped =
                            List.length raw.rows - List.length tail
                    in
                    if List.isEmpty unique then
                        ( done, invalid + bad + dropped, budget )

                    else
                        ( summarize raw unique :: done
                        , invalid + bad + dropped + (List.length rows - List.length unique)
                        , budget - List.length unique
                        )


dedupe : List Row -> List Row
dedupe rows =
    List.foldl
        (\row ( seen, acc ) ->
            if Set.member row.id seen then
                ( seen, acc )

            else
                ( Set.insert row.id seen, row :: acc )
        )
        ( Set.empty, [] )
        rows
        |> Tuple.second
        |> List.reverse


summarize : RawConversation -> List Row -> Conversation
summarize raw rows =
    let
        times =
            List.map .at rows
    in
    { key = raw.key
    , source =
        case cleanLabel raw.source of
            "" ->
                raw.key

            label ->
                label
    , suggested =
        case normalizeDestination raw.suggested of
            Ok _ ->
                String.trim raw.suggested

            Err _ ->
                ""
    , dm = raw.dm
    , rows = rows
    , count = List.length rows
    , dupCount = List.length (List.filter .dup rows)
    , oldest = Maybe.withDefault 0 (List.minimum times)
    , newest = Maybe.withDefault 0 (List.maximum times)
    }


{-| The vault's bounded-wire-token rule (C0, space, DEL refused). -}
isWireToken : Int -> Bool -> String -> Bool
isWireToken maxLength allowEmpty s =
    (allowEmpty || not (String.isEmpty s))
        && String.length s <= maxLength
        && not (String.any (\c -> Char.toCode c <= 0x20 || Char.toCode c == 0x7F) s)


isHex8 : String -> Bool
isHex8 s =
    String.length s == 8 && String.all Char.isHexDigit s


isForeignEnvelope : String -> Bool
isForeignEnvelope body =
    DmCipher.isEnvelope body || GroupEnvelope.isGroupEnvelope body || String.startsWith "TSUMUGI1 " body


validRow : Bool -> RawRow -> Maybe Row
validRow strict raw =
    let
        rowType =
            if String.isEmpty raw.rowType && strict then
                "msg"

            else
                raw.rowType

        reply =
            case raw.replyTo of
                Just r ->
                    if isWireToken VaultImport.maxMessageIdLength False r.id && isWireToken VaultImport.maxSenderLength True r.from then
                        Just { r | text = String.left maxReplyText r.text }

                    else
                        Nothing

                Nothing ->
                    Nothing
    in
    if
        isWireToken VaultImport.maxMessageIdLength False raw.id
            && isWireToken VaultImport.maxSenderLength True raw.from
            && not (String.isEmpty (String.trim raw.text))
            && String.length raw.text <= VaultImport.maxMessageTextLength
            && Set.member rowType VaultImport.messageTypes
            && not (isNaN raw.time || isInfinite raw.time)
            && raw.time > 0
            && raw.time < 1.0e14
            && (String.isEmpty raw.print || isHex8 raw.print)
            && not (strict && isForeignEnvelope raw.text)
    then
        Just
            { id = raw.id
            , from = raw.from
            , body = raw.text
            , at = floor raw.time
            , rowType = rowType
            , print = raw.print
            , dup = raw.dup
            , replyTo = reply
            }

    else
        Nothing


cleanLabel : String -> String
cleanLabel raw =
    raw
        |> String.left (maxLabel * 2)
        |> String.map
            (\c ->
                let
                    code =
                        Char.toCode c
                in
                if code < 0x20 || code == 0x7F || (code >= 0x202A && code <= 0x202E) || (code >= 0x2066 && code <= 0x2069) then
                    ' '

                else
                    c
            )
        |> String.words
        |> String.join " "
        |> String.left maxLabel


nonNegative : Int -> Int
nonNegative n =
    max 0 n


{-| Stage a portable snapshot that arrived through the legacy
`vaultImportFile` port (already validated by `VaultImport`). No
fingerprints ride along, so nothing is marked as already present. -}
fromVaultSnapshot : Int -> VaultImport.VaultImportSnapshot -> Maybe Staged
fromVaultSnapshot job snap =
    let
        conversations =
            List.filterMap
                (\t ->
                    case t.messages of
                        [] ->
                            Nothing

                        messages ->
                            let
                                rows =
                                    List.map
                                        (\m -> { id = m.id, from = m.from, body = m.body, at = floor m.atMs, rowType = m.msgType, print = "", dup = False, replyTo = Nothing })
                                        messages
                            in
                            Just
                                (summarize
                                    { key = "vault:" ++ t.target, source = t.target, suggested = t.target, dm = not (String.startsWith "#" t.target || String.startsWith "&" t.target), rows = [] }
                                    rows
                                )
                )
                snap.targets
    in
    if List.isEmpty conversations then
        Nothing

    else
        Just
            { job = job
            , source = Portable
            , label =
                if String.isEmpty snap.exportedAt then
                    "Onyx vault"

                else
                    "Onyx vault · " ++ String.left 10 snap.exportedAt
            , files = 1
            , rejectedFiles = 0
            , skipped = 0
            , systemSkipped = 0
            , duplicatesInFile = 0
            , droppedOverCap = 0
            , overBudget = 0
            , datesEstimated = False
            , invalid = 0
            , conversations = conversations
            }



-- DESTINATIONS


{-| A review destination: `#room` / `&room` (≤ 50, no space, comma,
BEL or control) or a person's nick (IRC nick charset, ≤ 30). Returns
the lowercased vault target and whether it is a DM. -}
normalizeDestination : String -> Result String { target : String, dm : Bool }
normalizeDestination raw =
    let
        value =
            String.trim raw
    in
    if String.isEmpty value then
        Err "Choose where these messages go."

    else if String.startsWith "#" value || String.startsWith "&" value then
        if String.length value < 2 then
            Err "Add a room name after the #."

        else if String.length value > 50 then
            Err "Room names are at most 50 characters."

        else if String.any (\c -> Char.toCode c <= 0x20 || Char.toCode c == 0x7F || c == ',' || c == '\u{0007}') value then
            Err "Room names cannot contain spaces or commas."

        else
            Ok { target = String.toLower value, dm = False }

    else if String.length value > 30 then
        Err "Nicks are at most 30 characters."

    else
        case String.uncons value of
            Just ( first, rest ) ->
                if isNickStart first && String.all isNickChar rest then
                    Ok { target = String.toLower value, dm = True }

                else
                    Err "Use a room like #name, or a person's nick."

            Nothing ->
                Err "Choose where these messages go."


isNickStart : Char -> Bool
isNickStart c =
    Char.isAlpha c && Char.toCode c < 0x80 || String.contains (String.fromChar c) "_[]\\`^{}|"


isNickChar : Char -> Bool
isNickChar c =
    isNickStart c || Char.isDigit c || c == '-'


destinationError : String -> Maybe String
destinationError raw =
    case normalizeDestination raw of
        Ok _ ->
            Nothing

        Err message ->
            Just message


{-| True when the destination merges into a room already open here. -}
isDestinationRoom : List String -> String -> Bool
isDestinationRoom open raw =
    case normalizeDestination raw of
        Ok { target } ->
            List.member target (List.map String.toLower open)

        Err _ ->
            False



-- STATE


type alias Dest =
    { include : Bool
    , value : String
    }


type alias Status =
    { message : String
    , failure : Bool
    }


type alias Batch =
    { id : String
    , kind : String
    , label : String
    , at : Int
    , messages : Int
    , targets : List String
    }


type Phase
    = Idle
    | Picking { job : Int, source : Source }
    | Working { job : Int, source : Source, step : String, done : Float, total : Float, files : Int }
    | Reviewing Staged


type alias State =
    { source : Source
    , phase : Phase
    , seq : Int
    , dests : Dict String Dest
    , showAll : Bool
    , status : Maybe Status
    , batches : List Batch
    , batchesLoaded : Bool
    , removeAsk : Maybe String
    , removing : Maybe String
    , lastBatch : Maybe Batch
    , owner : Maybe String
    }


blank : State
blank =
    { source = Discord
    , phase = Idle
    , seq = 0
    , dests = Dict.empty
    , showAll = False
    , status = Nothing
    , batches = []
    , batchesLoaded = False
    , removeAsk = Nothing
    , removing = Nothing
    , lastBatch = Nothing
    , owner = Nothing
    }


busy : State -> Bool
busy state =
    case state.phase of
        Idle ->
            state.removing /= Nothing

        _ ->
            True


destFor : State -> Conversation -> Dest
destFor state conversation =
    Dict.get conversation.key state.dests
        |> Maybe.withDefault { include = True, value = conversation.suggested }


reviewTitleId : String
reviewTitleId =
    "history-import-review-title"


{-| Where focus goes when the control that had it disappears (a review
closes, an import is removed): the live result line.
-}
statusId : String
statusId =
    "history-import-status-note"


removeButtonId : String -> String
removeButtonId batch =
    "history-import-batch-remove-" ++ batch


removeConfirmId : String -> String
removeConfirmId batch =
    "history-import-remove-" ++ batch


{-| What `update` needs from the outside: the clock, the signed-in
owner, and the device's history retention (the vault trims every
conversation to it after each write, so an import larger than it would
lose its oldest rows at once — the review must say so, and the plan
never writes rows the vault would drop on the spot).
-}
type alias Ctx =
    { nowMs : Float
    , owner : Maybe String
    , keepFor : String -> Int
    , maxAgeDays : Maybe Float
    }


type Msg
    = SelectSource Source
    | Choose Source
    | Progress { job : Int, phase : String, done : Float, total : Float, files : Int }
    | GotStaged Decode.Value
    | GotSnapshot Staged
    | Failed { job : Int, message : String }
    | Cancel
    | Toggle String
    | SetDest String String
    | IncludeAll Bool
    | ShowAll
    | Confirm
    | LoadBatches
    | Batches Decode.Value
    | RemoveAsk String
    | RemoveCancel
    | RemoveConfirm String
    | Undo
    | Removed { batch : String, removed : Int, ok : Bool, targets : List String, prints : List String }
    | DismissStatus


type Effect
    = Pick { job : Int, kind : String }
    | CancelJob { job : Int }
    | Persist { target : String, rows : List Row }
    | Record { batch : Batch, ids : List String, prints : List String }
    | ListBatches
    | RemoveBatch { batch : String }
    | Touched { targets : List String }
    | Focus String


update : Ctx -> Msg -> State -> ( State, List Effect )
update ctx msg state =
    case msg of
        SelectSource source ->
            ( { state | source = source }, [] )

        Choose source ->
            if busy state then
                ( state, [] )

            else
                let
                    job =
                        state.seq + 1
                in
                ( { state | seq = job, phase = Picking { job = job, source = source }, status = Nothing, removeAsk = Nothing, owner = ctx.owner }
                , [ Pick { job = job, kind = sourceKey source } ]
                )

        Progress p ->
            case state.phase of
                Picking pick ->
                    if pick.job == p.job then
                        ( { state | phase = Working { job = p.job, source = pick.source, step = p.phase, done = p.done, total = p.total, files = p.files } }, [] )

                    else
                        ( state, [] )

                Working w ->
                    if w.job == p.job then
                        ( { state | phase = Working { w | step = p.phase, done = p.done, total = p.total, files = p.files } }, [] )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        GotStaged value ->
            case ( currentJob state, decodeStaged value ) of
                ( Just job, Just staged ) ->
                    if staged.job == job then
                        stage staged state

                    else
                        ( state, [] )

                ( Just job, Nothing ) ->
                    if Result.toMaybe (Decode.decodeValue (Decode.field "job" Decode.int) value) == Just job then
                        ( { state | phase = Idle, status = Just { message = "Nothing in those files could be imported safely.", failure = True } }, [] )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        GotSnapshot staged ->
            if busy state then
                ( state, [] )

            else
                stage { staged | job = state.seq + 1 } { state | seq = state.seq + 1, owner = ctx.owner }

        Failed { job, message } ->
            if currentJob state == Just job then
                ( { state
                    | phase = Idle
                    , status =
                        if String.isEmpty message then
                            Nothing

                        else
                            Just { message = message, failure = True }
                  }
                , if String.isEmpty message then
                    []

                  else
                    [ Focus statusId ]
                )

            else
                ( state, [] )

        Cancel ->
            case state.phase of
                Reviewing _ ->
                    ( { state | phase = Idle, dests = Dict.empty, showAll = False, status = Just { message = "Import cancelled. Nothing was written.", failure = False } }
                    , [ Focus statusId ]
                    )

                Idle ->
                    ( state, [] )

                _ ->
                    ( { state | phase = Idle, status = Just { message = "Import cancelled. Nothing was written.", failure = False } }
                    , List.filterMap identity [ Maybe.map (\job -> CancelJob { job = job }) (currentJob state) ] ++ [ Focus statusId ]
                    )

        Toggle key ->
            withReview state
                (\staged ->
                    case List.filter (\c -> c.key == key) staged.conversations of
                        conversation :: _ ->
                            let
                                dest =
                                    destFor state conversation
                            in
                            ( { state | dests = Dict.insert key { dest | include = not dest.include } state.dests }, [] )

                        [] ->
                            ( state, [] )
                )

        SetDest key value ->
            withReview state
                (\staged ->
                    case List.filter (\c -> c.key == key) staged.conversations of
                        conversation :: _ ->
                            let
                                dest =
                                    destFor state conversation
                            in
                            ( { state | dests = Dict.insert key { dest | value = String.left 64 value } state.dests }, [] )

                        [] ->
                            ( state, [] )
                )

        IncludeAll on ->
            withReview state
                (\staged ->
                    ( { state
                        | dests =
                            List.foldl
                                (\c acc ->
                                    let
                                        dest =
                                            destFor state c
                                    in
                                    Dict.insert c.key { dest | include = on } acc
                                )
                                state.dests
                                staged.conversations
                      }
                    , []
                    )
                )

        ShowAll ->
            ( { state | showAll = True }, [] )

        Confirm ->
            withReview state (confirm ctx state)

        LoadBatches ->
            ( state, [ ListBatches ] )

        Batches value ->
            ( { state | batches = decodeBatches value, batchesLoaded = True }, [] )

        RemoveAsk id ->
            if state.removing == Nothing then
                ( { state | removeAsk = Just id }, [ Focus (removeConfirmId id) ] )

            else
                ( state, [] )

        RemoveCancel ->
            ( { state | removeAsk = Nothing }
            , case state.removeAsk of
                Just id ->
                    [ Focus (removeButtonId id) ]

                Nothing ->
                    []
            )

        RemoveConfirm id ->
            if state.removing == Nothing && state.removeAsk == Just id then
                ( { state | removeAsk = Nothing, removing = Just id, status = Nothing }, [ RemoveBatch { batch = id } ] )

            else
                ( state, [] )

        Undo ->
            case ( state.lastBatch, state.removing ) of
                ( Just batch, Nothing ) ->
                    ( { state | removing = Just batch.id, removeAsk = Nothing, status = Nothing }, [ RemoveBatch { batch = batch.id } ] )

                _ ->
                    ( state, [] )

        Removed r ->
            if state.removing == Just r.batch then
                ( { state
                    | removing = Nothing
                    , lastBatch =
                        if Maybe.map .id state.lastBatch == Just r.batch then
                            Nothing

                        else
                            state.lastBatch
                    , status =
                        Just
                            (if r.ok then
                                { message = "Removed " ++ countLabel r.removed "imported message" ++ " from this device.", failure = False }

                             else
                                { message = "That import could not be removed. Try again.", failure = True }
                            )
                  }
                , (if r.ok then
                    [ Touched { targets = r.targets } ]

                   else
                    []
                  )
                    ++ [ Focus statusId ]
                )

            else
                ( state, [] )

        DismissStatus ->
            ( { state | status = Nothing, lastBatch = Nothing }, [ Focus "history-import-choose" ] )


currentJob : State -> Maybe Int
currentJob state =
    case state.phase of
        Picking p ->
            Just p.job

        Working w ->
            Just w.job

        Reviewing s ->
            Just s.job

        Idle ->
            Nothing


withReview : State -> (Staged -> ( State, List Effect )) -> ( State, List Effect )
withReview state f =
    case state.phase of
        Reviewing staged ->
            f staged

        _ ->
            ( state, [] )


stage : Staged -> State -> ( State, List Effect )
stage staged state =
    ( { state | phase = Reviewing staged, dests = Dict.empty, showAll = False, status = Nothing, lastBatch = Nothing }
    , [ Focus reviewTitleId ]
    )


{-| Owner-change abort (oracle `useImportOwner`): an import staged for
one account never lands in another account's vault. -}
ownerChanged : State -> ( State, List Effect )
ownerChanged state =
    case state.phase of
        Idle ->
            ( state, [] )

        _ ->
            ( { state
                | phase = Idle
                , dests = Dict.empty
                , owner = Nothing
                , status = Just { message = "Import cancelled because the account on this device changed. Nothing was written.", failure = True }
              }
            , List.filterMap identity [ Maybe.map (\job -> CancelJob { job = job }) (currentJob state) ]
            )



-- CONFIRM


type alias Plan =
    { persists : List { target : String, rows : List Row }
    , written : Int
    , already : Int
    , trimmed : Int
    , targets : List String
    , errors : List ( String, String )
    }


{-| The writes a review produces: included conversations whose
destination is valid, new rows only (already-present rows are never
re-written), grouped by destination in time order, chunked. Any
invalid included destination is reported and blocks the import.

The device's retention applies per destination exactly as the vault's
trim will (age cutoff, then the newest `keep`): rows beyond it are
counted in `trimmed` and not written.
-}
plan : { a | nowMs : Float, keepFor : String -> Int, maxAgeDays : Maybe Float } -> State -> Staged -> Plan
plan limits state staged =
    let
        step conversation acc =
            let
                dest =
                    destFor state conversation
            in
            if not dest.include then
                acc

            else
                case normalizeDestination dest.value of
                    Err message ->
                        { acc | errors = acc.errors ++ [ ( conversation.key, message ) ] }

                    Ok { target } ->
                        let
                            fresh =
                                List.filter (not << .dup) conversation.rows
                        in
                        { acc
                            | byTarget = Dict.update target (\prior -> Just (Maybe.withDefault [] prior ++ fresh)) acc.byTarget
                            , order =
                                if List.member target acc.order then
                                    acc.order

                                else
                                    acc.order ++ [ target ]
                            , already = acc.already + conversation.dupCount
                        }

        folded =
            List.foldl step { byTarget = Dict.empty, order = [], already = 0, errors = [] } staged.conversations

        cutoff =
            Maybe.map (\days -> limits.nowMs - days * 86400000) limits.maxAgeDays

        retained target rows =
            let
                inAge =
                    case cutoff of
                        Just c ->
                            List.filter (\row -> toFloat row.at >= c) rows

                        Nothing ->
                            rows

                ordered =
                    List.sortWith (\a b -> compare ( a.at, a.id ) ( b.at, b.id )) inAge
            in
            List.drop (List.length ordered - max 0 (limits.keepFor target)) ordered

        kept =
            List.filterMap
                (\target ->
                    Dict.get target folded.byTarget
                        |> Maybe.map (\rows -> ( target, List.length rows, retained target rows ))
                )
                folded.order

        grouped =
            List.filter (\( _, _, rows ) -> not (List.isEmpty rows)) kept
    in
    { persists = List.concatMap (\( target, _, rows ) -> List.map (\chunk -> { target = target, rows = chunk }) (chunks 400 rows)) grouped
    , written = List.sum (List.map (\( _, _, rows ) -> List.length rows) grouped)
    , already = folded.already
    , trimmed = List.sum (List.map (\( _, total, rows ) -> total - List.length rows) kept)
    , targets = List.map (\( target, _, _ ) -> target) grouped
    , errors = folded.errors
    }


chunks : Int -> List a -> List (List a)
chunks size list =
    case list of
        [] ->
            []

        _ ->
            List.take size list :: chunks size (List.drop size list)


confirm : Ctx -> State -> Staged -> ( State, List Effect )
confirm ctx state staged =
    let
        p =
            plan ctx state staged
    in
    case p.errors of
        ( key, message ) :: _ ->
            ( { state | status = Just { message = message, failure = True } }, [ Focus ("history-import-dest-" ++ key) ] )

        [] ->
            if p.written == 0 then
                ( { state
                    | phase = Idle
                    , dests = Dict.empty
                    , status =
                        Just
                            (if p.trimmed > 0 then
                                { message = "Nothing imported: " ++ countLabel p.trimmed "message" ++ " fall outside the history this device keeps. Raise it in History & data first.", failure = False }

                             else if p.already > 0 then
                                { message = "Nothing new to import: " ++ countLabel p.already "message" ++ " already on this device.", failure = False }

                             else
                                { message = "Nothing selected, so nothing was imported.", failure = False }
                            )
                  }
                , []
                )

            else
                let
                    now =
                        floor ctx.nowMs

                    batch =
                        { id = "imp-" ++ String.fromInt now ++ "-" ++ String.fromInt staged.job
                        , kind = sourceKey staged.source
                        , label = batchLabel staged
                        , at = now
                        , messages = p.written
                        , targets = p.targets
                        }

                    rows =
                        List.concatMap .rows p.persists
                in
                ( { state
                    | phase = Idle
                    , dests = Dict.empty
                    , lastBatch = Just batch
                    , batches = batch :: List.filter (\b -> b.id /= batch.id) state.batches
                    , status =
                        Just
                            { message =
                                "Imported "
                                    ++ countLabel p.written "message"
                                    ++ " into "
                                    ++ (case p.targets of
                                            [ one ] ->
                                                one

                                            _ ->
                                                countLabel (List.length p.targets) "conversation"
                                       )
                                    ++ (if p.already > 0 then
                                            " (" ++ countLabel p.already "message" ++ " already here, skipped)"

                                        else
                                            ""
                                       )
                                    ++ (if p.trimmed > 0 then
                                            " (" ++ countLabel p.trimmed "older message" ++ " left out: beyond what this device keeps)"

                                        else
                                            ""
                                       )
                                    ++ ". Open a room to read them, or search from anywhere."
                            , failure = False
                            }
                  }
                , List.map Persist p.persists
                    ++ [ Record { batch = batch, ids = List.map .id rows, prints = List.filter (not << String.isEmpty) (List.map .print rows) }
                       , Touched { targets = p.targets }
                       , Focus statusId
                       ]
                )


batchLabel : Staged -> String
batchLabel staged =
    let
        short =
            (sourceInfo staged.source).short
    in
    if String.isEmpty staged.label || staged.source == Portable then
        if String.isEmpty staged.label then
            short

        else
            staged.label

    else
        short ++ " · " ++ staged.label



-- BATCH LIST


decodeBatches : Decode.Value -> List Batch
decodeBatches value =
    case Decode.decodeValue (Decode.field "batches" (Decode.list Decode.value)) value of
        Ok list ->
            List.filterMap (Decode.decodeValue batchDecoder >> Result.toMaybe) (List.take 200 list)

        Err _ ->
            []


batchDecoder : Decode.Decoder Batch
batchDecoder =
    Decode.map6 Batch
        (Decode.field "id" Decode.string |> Decode.andThen (\s -> if isWireToken 128 False s then Decode.succeed s else Decode.fail "id"))
        (Decode.oneOf [ Decode.field "kind" Decode.string, Decode.succeed "" ])
        (Decode.oneOf [ Decode.field "label" (Decode.map cleanLabel Decode.string), Decode.succeed "" ])
        (Decode.oneOf [ Decode.field "at" Decode.int, Decode.succeed 0 ])
        (Decode.oneOf [ Decode.field "messages" Decode.int, Decode.succeed 0 ])
        (Decode.oneOf [ Decode.field "targets" (Decode.list Decode.string), Decode.succeed [] ] |> Decode.map (List.take 4096))



-- FINGERPRINT


{-| The ports-side content fingerprint (`historyImport.js`
`fingerprint`): FNV-1a 32 over the UTF-16 units of
`floor(time) NUL lower(from) NUL text`, as 8 hex digits. Lets the App
drop removed import rows from an open buffer, where hydrated rows carry
no vault id. -}
fingerprint : Int -> String -> String -> String
fingerprint time from text =
    (String.fromInt time ++ "\u{0000}" ++ String.toLower from ++ "\u{0000}" ++ text)
        |> String.foldl (\c h -> List.foldl fnvUnit h (utf16Units (Char.toCode c))) 0x811C9DC5
        |> hex8


utf16Units : Int -> List Int
utf16Units code =
    if code > 0xFFFF then
        let
            v =
                code - 0x00010000
        in
        [ 0xD800 + Bitwise.shiftRightZfBy 10 v, 0xDC00 + Bitwise.and v 0x03FF ]

    else
        [ code ]


fnvUnit : Int -> Int -> Int
fnvUnit unit h =
    imul32 (Bitwise.xor h unit) 0x01000193


{-| Exact `Math.imul(a, b) >>> 0`: 16-bit halves keep every partial
product exact. -}
imul32 : Int -> Int -> Int
imul32 a b =
    let
        aLo =
            Bitwise.and a 0xFFFF

        aHi =
            Bitwise.and (Bitwise.shiftRightZfBy 16 a) 0xFFFF

        bLo =
            Bitwise.and b 0xFFFF

        bHi =
            Bitwise.and (Bitwise.shiftRightZfBy 16 b) 0xFFFF
    in
    Bitwise.shiftRightZfBy 0 (aLo * bLo + Bitwise.shiftLeftBy 16 (aHi * bLo + aLo * bHi))


hex8 : Int -> String
hex8 n =
    let
        digit d =
            String.slice d (d + 1) "0123456789abcdef"

        go k acc value =
            if k == 0 then
                acc

            else
                go (k - 1) (digit (Bitwise.and value 15) ++ acc) (Bitwise.shiftRightZfBy 4 value)
    in
    go 8 "" (Bitwise.shiftRightZfBy 0 n)



-- COPY HELPERS


{-| `1 message`, `1,234 messages`. -}
countLabel : Int -> String -> String
countLabel n noun =
    groupThousands n
        ++ " "
        ++ noun
        ++ (if n == 1 then
                ""

            else
                "s"
           )


groupThousands : Int -> String
groupThousands n =
    let
        go s =
            if String.length s <= 3 then
                s

            else
                go (String.dropRight 3 s) ++ "," ++ String.right 3 s
    in
    (if n < 0 then
        "-"

     else
        ""
    )
        ++ go (String.fromInt (abs n))


{-| `Jan 2, 2024` in the viewer's zone. -}
formatDay : Time.Zone -> Int -> String
formatDay zone ms =
    let
        t =
            Time.millisToPosix ms
    in
    monthName (Time.toMonth zone t) ++ " " ++ String.fromInt (Time.toDay zone t) ++ ", " ++ String.fromInt (Time.toYear zone t)


monthName : Time.Month -> String
monthName month =
    case month of
        Time.Jan ->
            "Jan"

        Time.Feb ->
            "Feb"

        Time.Mar ->
            "Mar"

        Time.Apr ->
            "Apr"

        Time.May ->
            "May"

        Time.Jun ->
            "Jun"

        Time.Jul ->
            "Jul"

        Time.Aug ->
            "Aug"

        Time.Sep ->
            "Sep"

        Time.Oct ->
            "Oct"

        Time.Nov ->
            "Nov"

        Time.Dec ->
            "Dec"


progressPercent : { a | done : Float, total : Float } -> Int
progressPercent p =
    if p.total <= 0 then
        0

    else
        clamp 0 100 (round (100 * p.done / p.total))
