module GapClaim exposing
    ( Answer(..)
    , Ctx
    , Effect(..)
    , Msg(..)
    , Op(..)
    , Outcome
    , Phase(..)
    , Scan(..)
    , State
    , Summary
    , attachBlocker
    , attachLabel
    , blank
    , busy
    , countsLine
    , decodeAnswer
    , elementId
    , explainLines
    , factsLine
    , homeVisible
    , isPending
    , outcomeText
    , prefsVisible
    , progressPercent
    , question
    , rangeLabel
    , scopeChanged
    , sharedDevice
    , update
    )

{-| v3/gap-claim — claiming the history that predates owner scoping.

Rows the local vault wrote BEFORE v3/gap-account carry no owner stamp.
They are quarantined: no identity sees, searches, exports or sends
them, and retention does not trim them. This module is the person's
explicit, one-time decision about them: **attach** them to the identity
signed in right now (the guest scope included), **delete** them, or say
**not now**. It never attaches on its own.

State and rules only; the vault work is `ports.js` (`gapClaim`: scan,
batched atomic attach / delete, verified counts) behind two ports
(`gapClaimRequest` / `gapClaimAnswer`), and `App` owns the wiring
(`updateGapClaim`, `settleStepGapClaim`).

Privacy: the scan answers counts and a date range only. No message text
is ever read into this state or shown in the prompt.

-}

import HistoryImport
import Json.Decode as Decode
import Time


{-| What the unstamped rows amount to. -}
type alias Summary =
    { rows : Int
    , conversations : Int
    , oldest : Maybe Int
    , newest : Maybe Int
    , undated : Int
    , otherOwners : Int
    , truncated : Bool
    }


type Scan
    = Unknown
    | Scanning
    | Found Summary
    | Clear
    | Unreadable


type Op
    = Attach
    | Delete


type alias Outcome =
    { op : Op
    , ok : Bool
    , reason : String
    , total : Int
    , moved : Int
    , merged : Int
    , remaining : Int
    }


type Phase
    = Resting
    | ConfirmingDelete
    | Working Op { done : Int, total : Int }
    | Finished Outcome


type alias State =
    { scope : Maybe String
    , scan : Scan
    , phase : Phase
    , dismissed : Bool
    , interrupted : Bool
    , guest : String
    }


blank : State
blank =
    { scope = Nothing
    , scan = Unknown
    , phase = Resting
    , dismissed = False
    , interrupted = False
    , guest = ""
    }


{-| What `update` needs to know about the app: the device-memory scope
the App settled, and whether local history is on. -}
type alias Ctx =
    { scope : Maybe String
    , localHistory : Bool
    }


type Msg
    = AttachClicked
    | NotNowClicked
    | DeleteAsked
    | DeleteCancelled
    | DeleteConfirmed
    | Acknowledged
    | Rescan
    | Answered Decode.Value


{-| `Request` crosses the claim ports; `HistoryChanged` is for the App
(the vault changed under the open conversations: drop DM privacy
proofs, hydrate empty buffers). -}
type Effect
    = Request { op : String, scope : String, guest : String }
    | HistoryChanged



-- ANSWERS (ports payloads)


type Answer
    = ScanAnswer
        { scope : String
        , ok : Bool
        , summary : Summary
        , dismissed : Bool
        , interrupted : Bool
        }
    | ProgressAnswer { scope : String, op : Op, done : Int, total : Int }
    | DoneAnswer
        { scope : String
        , op : Op
        , ok : Bool
        , reason : String
        , total : Int
        , attached : Int
        , merged : Int
        , deleted : Int
        , remaining : Int
        }


maxCount : Int
maxCount =
    1000000000


count : String -> Decode.Decoder Int
count name =
    Decode.oneOf [ Decode.field name Decode.int, Decode.succeed 0 ]
        |> Decode.map (clamp 0 maxCount)


{-| Remaining may be -1 (the verifying scan itself failed). -}
remainingCount : Decode.Decoder Int
remainingCount =
    Decode.oneOf [ Decode.field "remaining" Decode.int, Decode.succeed -1 ]
        |> Decode.map (clamp -1 maxCount)


flag : String -> Decode.Decoder Bool
flag name =
    Decode.oneOf [ Decode.field name Decode.bool, Decode.succeed False ]


stamp : String -> Decode.Decoder (Maybe Int)
stamp name =
    Decode.oneOf [ Decode.field name (Decode.nullable Decode.int), Decode.succeed Nothing ]
        |> Decode.map (Maybe.andThen (\n -> if n > 0 then Just n else Nothing))


opDecoder : Decode.Decoder Op
opDecoder =
    Decode.field "op" Decode.string
        |> Decode.andThen
            (\op ->
                case op of
                    "attach" ->
                        Decode.succeed Attach

                    "delete" ->
                        Decode.succeed Delete

                    _ ->
                        Decode.fail "unknown op"
            )


summaryDecoder : Decode.Decoder Summary
summaryDecoder =
    Decode.map7 Summary
        (count "rows")
        (count "conversations")
        (stamp "oldest")
        (stamp "newest")
        (count "undated")
        (count "otherOwners")
        (flag "truncated")


{-| Decode a `gapClaimAnswer`. Anything malformed, without a scope, or
of an unknown kind is rejected (the caller ignores it). -}
decodeAnswer : Decode.Value -> Maybe Answer
decodeAnswer value =
    let
        scoped : Decode.Decoder String
        scoped =
            Decode.field "scope" Decode.string
                |> Decode.andThen
                    (\scope ->
                        if String.isEmpty scope then
                            Decode.fail "no scope"

                        else
                            Decode.succeed scope
                    )

        decoder =
            Decode.field "kind" Decode.string
                |> Decode.andThen
                    (\kind ->
                        case kind of
                            "scan" ->
                                Decode.map5
                                    (\scope ok summary dismissed interrupted ->
                                        ScanAnswer { scope = scope, ok = ok, summary = summary, dismissed = dismissed, interrupted = interrupted }
                                    )
                                    scoped
                                    (flag "ok")
                                    summaryDecoder
                                    (flag "dismissed")
                                    (flag "interrupted")

                            "progress" ->
                                Decode.map4
                                    (\scope op done total -> ProgressAnswer { scope = scope, op = op, done = done, total = total })
                                    scoped
                                    opDecoder
                                    (count "done")
                                    (count "total")

                            "done" ->
                                Decode.map7
                                    (\scope op ok reason total ( attached, merged, deleted ) remaining ->
                                        DoneAnswer
                                            { scope = scope
                                            , op = op
                                            , ok = ok
                                            , reason = reason
                                            , total = total
                                            , attached = attached
                                            , merged = merged
                                            , deleted = deleted
                                            , remaining = remaining
                                            }
                                    )
                                    scoped
                                    opDecoder
                                    (flag "ok")
                                    (Decode.oneOf [ Decode.field "reason" Decode.string, Decode.succeed "" ] |> Decode.map (String.left 32))
                                    (count "total")
                                    (Decode.map3 (\a m d -> ( a, m, d )) (count "attached") (count "merged") (count "deleted"))
                                    remainingCount

                            _ ->
                                Decode.fail "unknown kind"
                    )
    in
    Decode.decodeValue decoder value |> Result.toMaybe



-- STATE MACHINE


{-| `guest` is the guest scope of the same network: a scan leaves it
out of the "other identities on this device" count (everyone starts as a
guest, so it says nothing about who else uses the device). -}
request : State -> String -> String -> Effect
request state op scope =
    Request { op = op, scope = scope, guest = state.guest }


{-| The scope the App settled moved (an identity change, or the first
scope after registration). Everything per-scope resets; the device-wide
"Not now" stays; the new scope is scanned. -}
scopeChanged : { scope : Maybe String, guest : String } -> State -> ( State, List Effect )
scopeChanged input state =
    if input.scope == state.scope then
        ( state, [] )

    else
        case input.scope of
            Just key ->
                let
                    next =
                        { blank | scope = Just key, scan = Scanning, dismissed = state.dismissed, guest = input.guest }
                in
                ( next, [ request next "scan" key ] )

            Nothing ->
                ( { blank | dismissed = state.dismissed, guest = input.guest }, [] )


{-| Attach or delete may start from rest, or again after a failure. -}
canStart : State -> Bool
canStart state =
    case state.phase of
        Resting ->
            True

        Finished outcome ->
            not outcome.ok

        _ ->
            False


foundSummary : State -> Maybe Summary
foundSummary state =
    case state.scan of
        Found summary ->
            Just summary

        _ ->
            Nothing


{-| Why Attach is unavailable right now (`Nothing` = it is available).
The copy is what the card shows in place of the button's promise. -}
attachBlocker : Bool -> Maybe String
attachBlocker localHistory =
    if localHistory then
        Nothing

    else
        Just "Local history is off, so older history can\u{2019}t be attached. Turn it on in History & data first, or delete it."


update : Ctx -> Msg -> State -> ( State, List Effect )
update ctx msg state =
    let
        live =
            case ( ctx.scope, state.scope ) of
                ( Just a, Just b ) ->
                    if a == b then
                        Just a

                    else
                        Nothing

                _ ->
                    Nothing
    in
    case msg of
        AttachClicked ->
            case ( live, foundSummary state ) of
                ( Just scope, Just summary ) ->
                    if canStart state && ctx.localHistory then
                        ( { state | phase = Working Attach { done = 0, total = summary.rows } }, [ request state "attach" scope ] )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        NotNowClicked ->
            case ( live, foundSummary state ) of
                ( Just scope, Just _ ) ->
                    if state.phase == Resting then
                        ( { state | dismissed = True }, [ request state "dismiss" scope ] )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        DeleteAsked ->
            case foundSummary state of
                Just _ ->
                    if canStart state && live /= Nothing then
                        ( { state | phase = ConfirmingDelete }, [] )

                    else
                        ( state, [] )

                Nothing ->
                    ( state, [] )

        DeleteCancelled ->
            if state.phase == ConfirmingDelete then
                ( { state | phase = Resting }, [] )

            else
                ( state, [] )

        DeleteConfirmed ->
            case ( live, foundSummary state ) of
                ( Just scope, Just summary ) ->
                    if state.phase == ConfirmingDelete then
                        ( { state | phase = Working Delete { done = 0, total = summary.rows } }, [ request state "delete" scope ] )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        Acknowledged ->
            case state.phase of
                Finished _ ->
                    ( { state | phase = Resting }, [] )

                _ ->
                    ( state, [] )

        Rescan ->
            case live of
                Just scope ->
                    case state.phase of
                        Working _ _ ->
                            ( state, [] )

                        _ ->
                            ( { state | scan = Scanning }, [ request state "scan" scope ] )

                Nothing ->
                    ( state, [] )

        Answered value ->
            case decodeAnswer value of
                Just answer ->
                    applyAnswer answer state

                Nothing ->
                    ( state, [] )


applyAnswer : Answer -> State -> ( State, List Effect )
applyAnswer answer state =
    case answer of
        ScanAnswer report ->
            if Just report.scope /= state.scope || isWorking state then
                -- an answer for a scope we left, or one that predates the
                -- operation in flight: the finished operation re-scans
                ( state, [] )

            else if not report.ok then
                ( { state | scan = Unreadable }, [] )

            else if report.summary.rows == 0 then
                ( { state | scan = Clear, dismissed = state.dismissed || report.dismissed, interrupted = False }, [] )

            else
                ( { state
                    | scan = Found report.summary
                    , dismissed = state.dismissed || report.dismissed
                    , interrupted = report.interrupted
                  }
                , []
                )

        ProgressAnswer report ->
            case state.phase of
                Working op _ ->
                    if Just report.scope == state.scope && op == report.op then
                        ( { state | phase = Working op { done = report.done, total = max report.total report.done } }, [] )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        DoneAnswer report ->
            case state.phase of
                Working op _ ->
                    if Just report.scope /= state.scope || op /= report.op then
                        ( state, [] )

                    else
                        let
                            moved =
                                case op of
                                    Attach ->
                                        report.attached

                                    Delete ->
                                        report.deleted

                            outcome =
                                { op = op
                                , ok = report.ok
                                , reason = report.reason
                                , total = report.total
                                , moved = moved
                                , merged = report.merged
                                , remaining = report.remaining
                                }

                            settled =
                                report.ok && report.remaining == 0

                            scan =
                                if settled then
                                    Clear

                                else
                                    case state.scan of
                                        Found summary ->
                                            if report.remaining > 0 then
                                                Found { summary | rows = report.remaining }

                                            else
                                                state.scan

                                        other ->
                                            other
                        in
                        ( { state | phase = Finished outcome, scan = scan }
                        , (if moved + report.merged > 0 then
                            [ HistoryChanged ]

                           else
                            []
                          )
                            ++ (if settled then
                                    []

                                else
                                    case state.scope of
                                        Just scope ->
                                            [ request state "scan" scope ]

                                        Nothing ->
                                            []
                               )
                        )

                _ ->
                    ( state, [] )


isWorking : State -> Bool
isWorking state =
    case state.phase of
        Working _ _ ->
            True

        _ ->
            False


{-| An attach or delete is running (the card shows progress). -}
busy : State -> Bool
busy =
    isWorking


isPending : State -> Bool
isPending state =
    foundSummary state /= Nothing



-- VISIBILITY


{-| The Home card: the one-time prompt. "Not now" hides it for good on
this device (Preferences keeps the way back); an operation started from
elsewhere never pops it back up. -}
homeVisible : State -> Bool
homeVisible state =
    not state.dismissed
        && (case state.phase of
                Resting ->
                    isPending state

                _ ->
                    True
           )


{-| The Preferences row: there while the rows exist, and while an
operation or its result is on screen. -}
prefsVisible : State -> Bool
prefsVisible state =
    case state.phase of
        Resting ->
            isPending state

        _ ->
            True



-- COPY


{-| DOM id of one part (`keep`, `delete`, `status`) of the card in one
place (`home` or `prefs`); the view and the focus moves agree here. -}
elementId : String -> String -> String
elementId place part =
    "gc-" ++ place ++ "-" ++ part


progressPercent : { done : Int, total : Int } -> Int
progressPercent progress =
    if progress.total <= 0 then
        0

    else
        clamp 0 100 (round (100 * toFloat progress.done / toFloat progress.total))


{-| `Mar 3, 2026 – Oct 8, 2026`, a single day, or a plain note when the
rows carry no usable time. -}
rangeLabel : Time.Zone -> Summary -> String
rangeLabel zone summary =
    case ( summary.oldest, summary.newest ) of
        ( Just oldest, Just newest ) ->
            let
                first =
                    HistoryImport.formatDay zone oldest

                last =
                    HistoryImport.formatDay zone newest

                span =
                    if first == last then
                        first

                    else
                        first ++ " \u{2013} " ++ last
            in
            if summary.undated > 0 then
                span ++ ", plus some undated"

            else
                span

        _ ->
            "dates unknown"


{-| `1,284 messages in 17 conversations`. A scan that hit its cap says
"more than". -}
countsLine : Summary -> String
countsLine summary =
    (if summary.truncated then
        "More than "

     else
        ""
    )
        ++ HistoryImport.countLabel summary.rows "message"
        ++ " in "
        ++ HistoryImport.countLabel summary.conversations "conversation"


{-| Counts and dates on one line (the view splits them on narrow cards). -}
factsLine : Time.Zone -> Summary -> String
factsLine zone summary =
    countsLine summary ++ " \u{00B7} " ++ rangeLabel zone summary


{-| Is this device used by more than one identity? Other owner stamps
already in the vault, or remembered sign-ins for someone other than the
current account, both say yes. -}
sharedDevice : { otherOwners : Int, remembered : List String, account : Maybe String } -> Bool
sharedDevice input =
    let
        me =
            Maybe.map String.toLower input.account

        others =
            List.filter (\nick -> Just (String.toLower nick) /= me) input.remembered
    in
    input.otherOwners > 0 || not (List.isEmpty others)


{-| "Attach it to kai?" / "Attach it to guest history?" (or "Finish
attaching it …" when an earlier attach was interrupted). -}
question : Bool -> Maybe String -> String
question interrupted account =
    (if interrupted then
        "Finish attaching it to "

     else
        "Attach it to "
    )
        ++ Maybe.withDefault "guest history" account
        ++ "?"


attachLabel : Bool -> Maybe String -> String
attachLabel interrupted account =
    (if interrupted then
        "Finish attaching to "

     else
        "Attach to "
    )
        ++ Maybe.withDefault "guest history" account


{-| The plain-language consequences, shown with every prompt. The old
rows cannot be matched to a single identity, so attaching moves ALL of
it; only the chosen identity sees it afterwards. -}
explainLines : { account : Maybe String, shared : Bool } -> List String
explainLines input =
    case input.account of
        Just name ->
            [ "Onyx now keeps history separately for each account, and this older history can\u{2019}t be matched to one. Attaching puts all of it under "
                ++ name
                ++ ". Only "
                ++ name
                ++ " will be able to see, search or export it. Nothing leaves this device."
            ]
                ++ (if input.shared then
                        [ "Other accounts and guests that use this device won\u{2019}t see it."
                        , sharedCaution
                        ]

                    else
                        []
                   )

        Nothing ->
            [ "You\u{2019}re not signed in. Guest history is shared by every guest session on this network, on this device. Anyone who uses Onyx here as a guest will be able to see it."
            , "Sign in first if you\u{2019}d rather keep it with your account. Nothing leaves this device."
            ]
                ++ (if input.shared then
                        [ "Accounts that use this device won\u{2019}t see it.", sharedCaution ]

                    else
                        []
                   )


{-| On a shared device the older history may not all be the viewer's. -}
sharedCaution : String
sharedCaution =
    "It may include conversations of other people who used Onyx on this device. If it isn\u{2019}t yours, delete it instead."


{-| The result line after an attach or delete. -}
outcomeText : Maybe String -> Outcome -> String
outcomeText account outcome =
    let
        who =
            Maybe.withDefault "guest history" account

        messages n =
            HistoryImport.countLabel n "message"
    in
    case outcome.op of
        Attach ->
            if outcome.ok then
                if outcome.moved + outcome.merged == 0 then
                    "Nothing was left to attach. It may already have been attached from another tab."

                else
                    "Attached "
                        ++ messages outcome.moved
                        ++ " to "
                        ++ who
                        ++ "."
                        ++ (if outcome.merged > 0 then
                                " " ++ messages outcome.merged ++ " " ++ (if outcome.merged == 1 then "was" else "were") ++ " already there and weren\u{2019}t duplicated."

                            else
                                ""
                           )
                        ++ " It\u{2019}s searchable now, and appears in each conversation\u{2019}s earlier messages as they load."

            else
                case outcome.reason of
                    "history-off" ->
                        "Local history is off, so older history can\u{2019}t be attached. Turn it on in History & data first, or delete it."

                    "unavailable" ->
                        "This browser\u{2019}s storage isn\u{2019}t available right now, so nothing was changed."

                    "scope" ->
                        "Onyx couldn\u{2019}t tell which identity to attach to, so nothing was changed. Reconnect and try again."

                    _ ->
                        HistoryImport.groupThousands outcome.moved
                            ++ " of "
                            ++ HistoryImport.groupThousands outcome.total
                            ++ " attached. The rest is still stored safely on this device \u{2014} nothing was lost. Try again to finish."

        Delete ->
            if outcome.ok then
                if outcome.moved == 0 then
                    "Nothing was left to delete."

                else
                    "Deleted " ++ messages outcome.moved ++ " from before this update."

            else
                case outcome.reason of
                    "unavailable" ->
                        "This browser\u{2019}s storage isn\u{2019}t available right now, so nothing was changed."

                    _ ->
                        "Couldn\u{2019}t delete everything"
                            ++ (if outcome.remaining > 0 then
                                    ": " ++ messages outcome.remaining ++ " still on this device."

                                else
                                    "."
                               )
                            ++ " Try again."
