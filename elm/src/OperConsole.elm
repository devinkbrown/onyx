module OperConsole exposing
    ( AppealsState
    , Clones
    , Ctx
    , Field(..)
    , Forms
    , Group
    , Listing
    , LogLine
    , Msg(..)
    , SpineStats
    , State
    , UserAppeal(..)
    , abuseHeadline
    , blank
    , claimWindowMs
    , maxLog
    , observeEvent
    , observeLine
    , refreshLines
    , sectionLog
    , setField
    , tabId
    , tabKeyHandled
    , update
    )

{-| v3/gap-oper — the operator console's state machine.

The desk is a set of tabs (Feed, Bans, Silence, Abuse, Appeals, Content,
Network). This module owns everything behind them and nothing about how
they look:

  - `update` — what a click does. It plans through `OperPlan`, stages
    state-changing commands for review, and returns the wire lines to
    send. It never sends by itself; the host turns the lines into
    `SendLine`.
  - `observeLine` / `observeEvent` — what the daemon said back. Lines a
    reply pattern claims (`OperReply.classify`) fill the tab's listing and
    its reply log. A server line no pattern claims is attributed to the
    section of the command just sent when it arrives inside the reply
    window, so a refusal ("Permission denied", "No such nick") is never
    lost in the invisible service log.

The guard rails: only server-origin lines count (`OperReply.classify`
checks), everything the desk keeps is bounded, and a non-operator session
reads exactly one family of replies — its own appeal.

-}

import Dict exposing (Dict)
import Json.Decode as Decode
import OperFeed
import OperPlan exposing (Intent(..))
import OperReply exposing (Reply(..), Section(..), Tone(..))
import Set
import Wire


{-| What the console needs from the host model. -}
type alias Ctx =
    { live : Bool
    , isOper : Bool
    , nowMs : Float
    }


{-| A server-sent list. `rows` is what the tab shows; `incoming` fills
while a list is in flight and replaces `rows` at the terminator, so a
refresh never flickers an empty table. -}
type alias Listing a =
    { rows : List a
    , incoming : List a
    , loading : Bool
    , loadedAtMs : Maybe Float
    }


emptyListing : Listing a
emptyListing =
    { rows = [], incoming = [], loading = False, loadedAtMs = Nothing }


maxRows : Int
maxRows =
    1024


type alias LogLine =
    { atMs : Float
    , section : Section
    , tone : Tone
    , text : String
    }


maxLog : Int
maxLog =
    240


{-| A reply line that no pattern claims is still the answer to the
command just sent if it lands inside this window. -}
claimWindowMs : Float
claimWindowMs =
    8000


chattyExtensionMs : Float
chattyExtensionMs =
    3000


type alias Group =
    { header : OperReplyCloneHeader
    , members : List OperReply.CloneMember
    }


type alias OperReplyCloneHeader =
    OperReply.CloneCluster


type alias Clones =
    { policy : List String
    , groups : List Group
    , none : Bool
    , loading : Bool
    , loadedAtMs : Maybe Float
    }


type alias AppealsState =
    { listing : Listing OperReply.Appeal
    , answering : Maybe Int
    }


{-| The person's own appeal (the user-side form). -}
type UserAppeal
    = AppealIdle
    | AppealSending
    | AppealFiledAs Int
    | AppealRefused String


type alias SpineStats =
    { total : Int
    , historyDepth : Int
    , categories : List ( String, Int )
    , severities : List ( String, Int )
    }


type alias Forms =
    { ban : OperPlan.BanForm
    , testMatch : String
    , testValue : String
    , shunMask : String
    , shunDuration : OperPlan.Duration
    , shunReason : String
    , gagNick : String
    , quarantineNick : String
    , quarantineChannel : String
    , quarantineReason : String
    , abuseNick : String
    , sessions : OperPlan.SessionsForm
    , appealAnswer : String
    , appealText : String
    , filterPattern : String
    , spamKind : String
    , spamTarget : String
    , holdChannel : String
    , holdNick : String
    , challengeQuestion : String
    , challengeAnswer : String
    , reportPick : String
    }


blankForms : Forms
blankForms =
    { ban =
        { kind = OperPlan.Kline
        , match = "mask"
        , pattern = ""
        , scope = "node"
        , action = "expel"
        , duration = OperPlan.blankDuration
        , reason = ""
        }
    , testMatch = "mask"
    , testValue = ""
    , shunMask = ""
    , shunDuration = OperPlan.blankDuration
    , shunReason = ""
    , gagNick = ""
    , quarantineNick = ""
    , quarantineChannel = "#quarantine"
    , quarantineReason = ""
    , abuseNick = ""
    , sessions = OperPlan.blankSessionsForm
    , appealAnswer = ""
    , appealText = ""
    , filterPattern = ""
    , spamKind = "NICK"
    , spamTarget = ""
    , holdChannel = ""
    , holdNick = ""
    , challengeQuestion = ""
    , challengeAnswer = ""
    , reportPick = "MESH|"
    }


type alias State =
    { tab : Section
    , feed : OperFeed.Feed
    , subscribed : Maybe (List String)
    , floor : Maybe String
    , stats : Maybe SpineStats
    , wards : Listing OperReply.Ward
    , shuns : Listing OperReply.Shun
    , filters : Listing { index : Int, pattern : String }
    , sessions : Listing OperReply.Session
    , appeals : AppealsState
    , abuse : Maybe { nick : String, facts : List ( String, String ) }
    , clones : Clones
    , spamtrap : Maybe { nicks : Int, channels : Int, offenders : Int, trips : Int }
    , policy : Maybe { ward : Int, filter : Int, class : Int, ban : Int }
    , privileges : Maybe { class : String, privileges : List String }
    , forms : Forms
    , pending : Maybe OperPlan.Command
    , errors : List String
    , log : List LogLine
    , claimUntilMs : Float
    , claimSection : Section
    , userAppeal : UserAppeal
    }


blank : State
blank =
    { tab = Feed
    , feed = OperFeed.empty
    , subscribed = Nothing
    , floor = Nothing
    , stats = Nothing
    , wards = emptyListing
    , shuns = emptyListing
    , filters = emptyListing
    , sessions = emptyListing
    , appeals = { listing = emptyListing, answering = Nothing }
    , abuse = Nothing
    , clones = { policy = [], groups = [], none = False, loading = False, loadedAtMs = Nothing }
    , spamtrap = Nothing
    , policy = Nothing
    , privileges = Nothing
    , forms = blankForms
    , pending = Nothing
    , errors = []
    , log = []
    , claimUntilMs = 0
    , claimSection = Feed
    , userAppeal = AppealIdle
    }



-- FORM FIELDS


type Field
    = BanKindField
    | BanMatch
    | BanPattern
    | BanScope
    | BanAction
    | BanDurationChoice
    | BanDurationAmount
    | BanDurationUnit
    | BanReason
    | TestMatch
    | TestValue
    | ShunMask
    | ShunDurationChoice
    | ShunDurationAmount
    | ShunDurationUnit
    | ShunReason
    | GagNick
    | QuarantineNick
    | QuarantineChannel
    | QuarantineReason
    | AbuseNick
    | SessionsWho
    | SessionsTransport
    | SessionsAccount
    | SessionsIp
    | SessionsSort
    | SessionsLimit
    | AppealAnswerText
    | AppealText
    | FilterPattern
    | SpamKind
    | SpamTarget
    | HoldChannel
    | HoldNick
    | ChallengeQuestionText
    | ChallengeAnswerText
    | ReportPick
    | FeedFilterText


setField : Field -> String -> Forms -> Forms
setField field value forms =
    let
        ban =
            forms.ban

        sessions =
            forms.sessions

        shunDuration =
            forms.shunDuration
    in
    case field of
        BanKindField ->
            { forms | ban = { ban | kind = kindOf value } }

        BanMatch ->
            { forms | ban = { ban | match = value } }

        BanPattern ->
            { forms | ban = { ban | pattern = value } }

        BanScope ->
            { forms | ban = { ban | scope = value } }

        BanAction ->
            { forms | ban = { ban | action = value } }

        BanDurationChoice ->
            { forms | ban = { ban | duration = withChoice value ban.duration } }

        BanDurationAmount ->
            { forms | ban = { ban | duration = withAmount value ban.duration } }

        BanDurationUnit ->
            { forms | ban = { ban | duration = withUnit value ban.duration } }

        BanReason ->
            { forms | ban = { ban | reason = value } }

        TestMatch ->
            { forms | testMatch = value }

        TestValue ->
            { forms | testValue = value }

        ShunMask ->
            { forms | shunMask = value }

        ShunDurationChoice ->
            { forms | shunDuration = withChoice value shunDuration }

        ShunDurationAmount ->
            { forms | shunDuration = withAmount value shunDuration }

        ShunDurationUnit ->
            { forms | shunDuration = withUnit value shunDuration }

        ShunReason ->
            { forms | shunReason = value }

        GagNick ->
            { forms | gagNick = value }

        QuarantineNick ->
            { forms | quarantineNick = value }

        QuarantineChannel ->
            { forms | quarantineChannel = value }

        QuarantineReason ->
            { forms | quarantineReason = value }

        AbuseNick ->
            { forms | abuseNick = value }

        SessionsWho ->
            { forms | sessions = { sessions | who = value } }

        SessionsTransport ->
            { forms | sessions = { sessions | transport = value } }

        SessionsAccount ->
            { forms | sessions = { sessions | account = value } }

        SessionsIp ->
            { forms | sessions = { sessions | ip = value } }

        SessionsSort ->
            { forms | sessions = { sessions | sort = value } }

        SessionsLimit ->
            { forms | sessions = { sessions | limit = value } }

        AppealAnswerText ->
            { forms | appealAnswer = value }

        AppealText ->
            { forms | appealText = value }

        FilterPattern ->
            { forms | filterPattern = value }

        SpamKind ->
            { forms | spamKind = value }

        SpamTarget ->
            { forms | spamTarget = value }

        HoldChannel ->
            { forms | holdChannel = value }

        HoldNick ->
            { forms | holdNick = value }

        ChallengeQuestionText ->
            { forms | challengeQuestion = value }

        ChallengeAnswerText ->
            { forms | challengeAnswer = value }

        ReportPick ->
            { forms | reportPick = value }

        FeedFilterText ->
            forms


kindOf : String -> OperPlan.BanKind
kindOf value =
    case value of
        "dline" ->
            OperPlan.Dline

        "xline" ->
            OperPlan.Xline

        "ward" ->
            OperPlan.Ward

        _ ->
            OperPlan.Kline


withChoice : String -> OperPlan.Duration -> OperPlan.Duration
withChoice value duration =
    { duration | choice = value }


withAmount : String -> OperPlan.Duration -> OperPlan.Duration
withAmount value duration =
    { duration | amount = String.left 6 (String.filter Char.isDigit value) }


withUnit : String -> OperPlan.Duration -> OperPlan.Duration
withUnit value duration =
    { duration | unit = value }



-- UPDATE


type Msg
    = SelectTab Section
    | TabKey String
    | Edit Field String
    | Run Intent
    | Confirm
    | Cancel
    | Refresh Section
    | Opened
    | Disconnected
    | FeedPause
    | FeedResume
    | FeedClear
    | FeedToggleCategory String
    | FeedCategory String
    | FeedSeverity String
    | FeedText String
    | FeedReset
    | FollowToggle String
    | SetFloor String
    | ClearLog Section
    | AnswerAppeal (Maybe Int)
    | SendUserAppeal


{-| Apply one message. Returns the new state and the CRLF-terminated
lines the host should send. -}
update : Ctx -> Msg -> State -> ( State, List String )
update ctx msg state =
    case msg of
        SelectTab section ->
            let
                moved =
                    { state | tab = section, errors = [], pending = Nothing }
            in
            if needsLoad section moved then
                refreshLines ctx section moved

            else
                ( moved, [] )

        TabKey key ->
            let
                next =
                    rovingTab key state.tab
            in
            if next == state.tab then
                ( state, [] )

            else
                update ctx (SelectTab next) state

        Edit field value ->
            ( { state | forms = setField field value state.forms, errors = [] }, [] )

        Run intent ->
            run ctx intent state

        Confirm ->
            case state.pending of
                Nothing ->
                    ( state, [] )

                Just cmd ->
                    if not (canSend ctx) then
                        ( { state | errors = [ offlineCopy ctx ] }, [] )

                    else
                        sendCommand ctx cmd { state | pending = Nothing, errors = [] }

        Cancel ->
            ( { state | pending = Nothing, errors = [] }, [] )

        Refresh section ->
            refreshLines ctx section state

        Opened ->
            if ctx.live && ctx.isOper && state.subscribed == Nothing then
                sendRead ctx EventsReport state

            else
                ( state, [] )

        Disconnected ->
            ( { state
                | subscribed = Nothing
                , floor = Nothing
                , pending = Nothing
                , wards = stopLoading state.wards
                , shuns = stopLoading state.shuns
                , filters = stopLoading state.filters
                , sessions = stopLoading state.sessions
                , appeals = { listing = stopLoading state.appeals.listing, answering = state.appeals.answering }
                , clones = (\c -> { c | loading = False }) state.clones
                , userAppeal =
                    case state.userAppeal of
                        AppealSending ->
                            AppealRefused "The connection closed before the appeal was filed. Try again once you are back online."

                        other ->
                            other
              }
            , []
            )

        FeedPause ->
            ( { state | feed = OperFeed.pause state.feed }, [] )

        FeedResume ->
            ( { state | feed = OperFeed.resume state.feed }, [] )

        FeedClear ->
            ( { state | feed = OperFeed.clear state.feed }, [] )

        FeedToggleCategory category ->
            let
                filter =
                    state.feed.filter

                next =
                    if Set.member category filter.categories then
                        Set.remove category filter.categories

                    else
                        Set.insert category filter.categories
            in
            ( { state | feed = OperFeed.setFilter { filter | categories = next } state.feed }, [] )

        FeedCategory category ->
            let
                filter =
                    state.feed.filter
            in
            ( { state
                | feed =
                    OperFeed.setFilter
                        { filter
                            | categories =
                                if category == "" then
                                    Set.empty

                                else
                                    Set.singleton category
                        }
                        state.feed
              }
            , []
            )

        FeedSeverity severity ->
            let
                filter =
                    state.feed.filter
            in
            ( { state | feed = OperFeed.setFilter { filter | minSeverity = severity } state.feed }, [] )

        FeedText text ->
            let
                filter =
                    state.feed.filter
            in
            ( { state | feed = OperFeed.setFilter { filter | text = String.left 80 text } state.feed }, [] )

        FeedReset ->
            ( { state | feed = OperFeed.setFilter OperFeed.blankFilter state.feed }, [] )

        FollowToggle category ->
            let
                following =
                    state.subscribed
                        |> Maybe.map (List.member category)
                        |> Maybe.withDefault False
            in
            run ctx (Follow { category = category, on = not following }) state

        SetFloor severity ->
            if severity == "" then
                ( state, [] )

            else
                run ctx (MinSeverity severity) state

        ClearLog section ->
            ( { state | log = List.filter (\l -> l.section /= section) state.log }, [] )

        AnswerAppeal which ->
            let
                appeals =
                    state.appeals
            in
            ( { state
                | appeals = { appeals | answering = which }
                , forms = setField AppealAnswerText "" state.forms
                , errors = []
              }
            , []
            )

        SendUserAppeal ->
            case OperPlan.plan (AppealSubmit state.forms.appealText) of
                Err errors ->
                    ( { state | userAppeal = AppealRefused (String.join " " errors) }, [] )

                Ok cmd ->
                    if not ctx.live then
                        ( { state | userAppeal = AppealRefused "Connect first — an appeal is filed over a live connection." }, [] )

                    else
                        ( { state | userAppeal = AppealSending }, [ OperPlan.toLine cmd ] )


{-| Arrow / Home / End over the tab list, wrapping. -}
rovingTab : String -> Section -> Section
rovingTab key current =
    let
        all =
            OperReply.sections

        count =
            List.length all

        index =
            all
                |> List.indexedMap Tuple.pair
                |> List.filter (\( _, s ) -> s == current)
                |> List.head
                |> Maybe.map Tuple.first
                |> Maybe.withDefault 0

        at i =
            all |> List.drop (modBy count i) |> List.head |> Maybe.withDefault current
    in
    case key of
        "ArrowRight" ->
            at (index + 1)

        "ArrowDown" ->
            at (index + 1)

        "ArrowLeft" ->
            at (index - 1 + count)

        "ArrowUp" ->
            at (index - 1 + count)

        "Home" ->
            at 0

        "End" ->
            at (count - 1)

        _ ->
            current


canSend : Ctx -> Bool

canSend ctx =
    ctx.live && ctx.isOper


offlineCopy : Ctx -> String
offlineCopy ctx =
    if not ctx.live then
        "Reconnect to send operator commands. Drafts stay on this device."

    else
        "This network grants operator status from the signed-in account."


run : Ctx -> Intent -> State -> ( State, List String )
run ctx intent state =
    case OperPlan.plan intent of
        Err errors ->
            ( { state | errors = errors, pending = Nothing }, [] )

        Ok cmd ->
            if not (canSend ctx) then
                ( { state | errors = [ offlineCopy ctx ] }, [] )

            else if cmd.mutates then
                ( { state | pending = Just cmd, errors = [] }, [] )

            else
                sendCommand ctx cmd { state | errors = [] }


sendRead : Ctx -> Intent -> State -> ( State, List String )
sendRead ctx intent state =
    case OperPlan.plan intent of
        Ok cmd ->
            sendCommand ctx cmd state

        Err _ ->
            ( state, [] )


{-| Send one planned command: stamp the reply window, mark the lists it
will refill as loading, clear the form fields it consumed, and queue the
list refresh a change implies. -}
sendCommand : Ctx -> OperPlan.Command -> State -> ( State, List String )
sendCommand ctx cmd state =
    let
        armed =
            { state
                | claimUntilMs = ctx.nowMs + claimWindowMs
                , claimSection = cmd.section
            }

        marked =
            markLoading cmd armed

        consumed =
            consumeForm cmd marked

        logged =
            if cmd.mutates then
                pushLog ctx.nowMs cmd.section Plain ("Sent " ++ OperPlan.preview (redacted cmd)) consumed

            else
                consumed

        ( refreshed, extra ) =
            followUp cmd logged
    in
    ( refreshed, OperPlan.toLine cmd :: extra )


{-| The challenge answer is a shared secret: it never lands in the log. -}
redacted : OperPlan.Command -> OperPlan.Command
redacted cmd =
    if cmd.verb == "CHALLENGE" then
        { cmd | trailing = Maybe.map (\_ -> "…") cmd.trailing }

    else
        cmd


markLoading : OperPlan.Command -> State -> State
markLoading cmd state =
    case ( cmd.verb, cmd.args ) of
        ( "WARD", [ "LIST" ] ) ->
            { state | wards = startLoading state.wards }

        ( "SHUN", [] ) ->
            { state | shuns = startLoading state.shuns }

        ( "FILTER", [ "LIST" ] ) ->
            { state | filters = startLoading state.filters }

        ( "SESSIONS", _ ) ->
            { state | sessions = startLoading state.sessions }

        ( "APPEAL", [ "LIST" ] ) ->
            let
                appeals =
                    state.appeals
            in
            { state | appeals = { appeals | listing = startLoading appeals.listing } }

        ( "CLONES", _ ) ->
            { state | clones = { policy = [], groups = [], none = False, loading = True, loadedAtMs = state.clones.loadedAtMs } }

        ( "ABUSE", [ nick ] ) ->
            { state | abuse = Just { nick = nick, facts = [] } }

        _ ->
            state


consumeForm : OperPlan.Command -> State -> State
consumeForm cmd state =
    let
        forms =
            state.forms

        ban =
            forms.ban
    in
    case ( cmd.verb, cmd.args ) of
        ( "WARD", "ADD" :: _ ) ->
            { state | forms = { forms | ban = { ban | pattern = "", reason = "" } } }

        ( v, "ADD" :: _ ) ->
            if List.member v [ "KLINE", "DLINE", "XLINE" ] then
                { state | forms = { forms | ban = { ban | pattern = "", reason = "" } } }

            else if v == "FILTER" then
                { state | forms = { forms | filterPattern = "" } }

            else if v == "SPAMTRAP" then
                state

            else
                state

        ( "SHUN", _ :: _ ) ->
            { state | forms = { forms | shunMask = "", shunReason = "" } }

        ( "QUARANTINE", _ ) ->
            { state | forms = { forms | quarantineNick = "", quarantineReason = "" } }

        ( "APPEAL", [ "ANSWER", _ ] ) ->
            let
                appeals =
                    state.appeals
            in
            { state | appeals = { appeals | answering = Nothing }, forms = { forms | appealAnswer = "" } }

        ( "CHALLENGE", "QUESTION" :: _ ) ->
            { state | forms = { forms | challengeQuestion = "", challengeAnswer = "" } }

        _ ->
            state


{-| After a change, ask for the list it changed so the tab shows the
truth, not a guess. -}
followUp : OperPlan.Command -> State -> ( State, List String )
followUp cmd state =
    let
        list intent =
            case OperPlan.plan intent of
                Ok next ->
                    Just next

                Err _ ->
                    Nothing

        chosen =
            case ( cmd.verb, cmd.args ) of
                ( "WARD", "ADD" :: _ ) ->
                    list BanList

                ( "WARD", "DEL" :: _ ) ->
                    list BanList

                ( v, "ADD" :: _ ) ->
                    if List.member v [ "KLINE", "DLINE", "XLINE" ] then
                        list BanList

                    else if v == "FILTER" then
                        list FilterList

                    else if v == "SPAMTRAP" then
                        list SpamtrapStatus

                    else
                        Nothing

                ( "FILTER", "DEL" :: _ ) ->
                    list FilterList

                ( "SPAMTRAP", _ ) ->
                    list SpamtrapStatus

                ( "SHUN", _ :: _ ) ->
                    list ShunList

                ( "UNSHUN", _ ) ->
                    list ShunList

                ( "APPEAL", [ "ANSWER", _ ] ) ->
                    list AppealsList

                ( "POLICY", [ "ROLLBACK" ] ) ->
                    list PolicyShow

                _ ->
                    Nothing
    in
    case chosen of
        Just next ->
            ( markLoading next state, [ OperPlan.toLine next ] )

        Nothing ->
            ( state, [] )



{-| The read commands a tab fills itself from. -}
refreshLines : Ctx -> Section -> State -> ( State, List String )
refreshLines ctx section state =
    if not (ctx.live && ctx.isOper) then
        ( state, [] )

    else
        let
            intents =
                case section of
                    Feed ->
                        [ EventsReport, EventStats ]

                    Bans ->
                        [ BanList ]

                    Silence ->
                        [ ShunList ]

                    Abuse ->
                        [ ClonesScan ]

                    Appeals ->
                        [ AppealsList ]

                    Content ->
                        [ FilterList, SpamtrapStatus, PolicyShow ]

                    Network ->
                        []

            step intent ( acc, lines ) =
                case OperPlan.plan intent of
                    Ok cmd ->
                        ( markLoading cmd acc, lines ++ [ OperPlan.toLine cmd ] )

                    Err _ ->
                        ( acc, lines )

            ( marked, out ) =
                List.foldl step ( state, [] ) intents
        in
        if List.isEmpty out then
            ( marked, [] )

        else
            ( { marked | claimUntilMs = ctx.nowMs + claimWindowMs, claimSection = section }, out )


needsLoad : Section -> State -> Bool
needsLoad section state =
    case section of
        Feed ->
            state.subscribed == Nothing

        Bans ->
            state.wards.loadedAtMs == Nothing && not state.wards.loading

        Silence ->
            state.shuns.loadedAtMs == Nothing && not state.shuns.loading

        Abuse ->
            False

        Appeals ->
            state.appeals.listing.loadedAtMs == Nothing && not state.appeals.listing.loading

        Content ->
            state.filters.loadedAtMs == Nothing && not state.filters.loading

        Network ->
            False



-- LISTINGS


startLoading : Listing a -> Listing a
startLoading listing =
    { listing | loading = True, incoming = [] }


stopLoading : Listing a -> Listing a
stopLoading listing =
    { listing | loading = False, incoming = [] }


addRow : a -> Listing a -> Listing a
addRow row listing =
    if List.length listing.incoming >= maxRows then
        listing

    else
        { listing | loading = True, incoming = row :: listing.incoming }


finishListing : Float -> Listing a -> Listing a
finishListing nowMs listing =
    { listing
        | rows = List.reverse listing.incoming
        , incoming = []
        , loading = False
        , loadedAtMs = Just nowMs
    }



-- LOG


pushLog : Float -> Section -> Tone -> String -> State -> State
pushLog nowMs section tone text state =
    let
        clean =
            String.left 400 (String.filter (\c -> Char.toCode c >= 0x20 && Char.toCode c /= 0x7F) text)
    in
    case state.log of
        top :: _ ->
            if top.section == section && top.text == clean then
                state

            else
                { state | log = List.take maxLog ({ atMs = nowMs, section = section, tone = tone, text = clean } :: state.log) }

        [] ->
            { state | log = [ { atMs = nowMs, section = section, tone = tone, text = clean } ] }


{-| Newest first, for one tab. -}
sectionLog : Section -> State -> List LogLine
sectionLog section state =
    List.filter (\l -> l.section == section) state.log



-- OBSERVE


{-| One Event Spine row from the daemon. -}
observeEvent : Ctx -> OperFeed.Draft -> State -> State
observeEvent ctx draft state =
    if not ctx.isOper then
        state

    else
        let
            pushed =
                { state | feed = OperFeed.push ctx.nowMs draft state.feed }
        in
        if draft.category == "OPER_ACTION" && ctx.nowMs <= pushed.claimUntilMs then
            -- The daemon confirms WARD / SHUN / SPAMTRAP changes only on
            -- the Event Spine: surface it in the tab that asked.
            extendClaim ctx (pushLog ctx.nowMs pushed.claimSection Good ("Confirmed: " ++ draft.text) pushed)

        else
            pushed


extendClaim : Ctx -> State -> State
extendClaim ctx state =
    { state | claimUntilMs = max state.claimUntilMs (ctx.nowMs + chattyExtensionMs) }


{-| One non-event server line. -}
observeLine : Ctx -> Wire.IrcMessage -> State -> State
observeLine ctx message state =
    case OperReply.classify message of
        Just reply ->
            applyReply ctx reply state

        Nothing ->
            if not ctx.isOper then
                state

            else
                observeUnclaimed ctx message state


observeUnclaimed : Ctx -> Wire.IrcMessage -> State -> State
observeUnclaimed ctx message state =
    let
        text =
            String.filter (\c -> Char.toCode c >= 0x20 && Char.toCode c /= 0x7F) (Maybe.withDefault "" (List.head (List.reverse message.params)))

        inWindow =
            ctx.nowMs <= state.claimUntilMs && message.nick == Nothing
    in
    if message.command == "NOTICE" && message.nick == Nothing then
        if String.startsWith "{\"total\":" text then
            case decodeStats text of
                Just stats ->
                    { state | stats = Just stats }

                Nothing ->
                    state

        else if inWindow && not (List.isEmpty state.clones.groups) && String.startsWith "  " text then

            case OperReply.parseCloneMember text of
                Just member ->
                    { state | clones = addCloneMember member state.clones }

                Nothing ->
                    state

        else if inWindow && text /= "" then
            extendClaim ctx (pushLog ctx.nowMs state.claimSection (toneOfText text) text state)

        else
            state

    else if inWindow && OperReply.isErrorNumeric message.command then
        extendClaim ctx
            (finishClaimed ctx
                (pushLog ctx.nowMs state.claimSection Bad (numericText message) state)
            )

    else if inWindow && isInformationalNumeric message.command then
        extendClaim ctx (pushLog ctx.nowMs state.claimSection Plain (numericText message) state)

    else
        state


isInformationalNumeric : String -> Bool
isInformationalNumeric command =
    String.length command == 3
        && String.all Char.isDigit command
        && List.member (String.left 1 command) [ "2", "3", "7" ]
        && not (List.member command [ "372", "375", "376", "251", "252", "254", "255", "265", "266" ])


numericText : Wire.IrcMessage -> String
numericText message =
    String.join " " (List.drop 1 message.params)
        |> String.trim
        |> (\t ->
                if t == "" then
                    "Server reply " ++ message.command

                else
                    t
           )


toneOfText : String -> Tone
toneOfText text =
    let
        lower =
            String.toLower text
    in
    if List.any (\needle -> String.contains needle lower) [ "denied", "failed", "no such", "invalid", "usage:" ] then
        Warn

    else
        Plain


{-| An error ends whatever the section was loading. -}
finishClaimed : Ctx -> State -> State
finishClaimed _ state =
    case state.claimSection of
        Bans ->
            { state | wards = stopLoading state.wards }

        Silence ->
            { state | shuns = stopLoading state.shuns }

        Appeals ->
            let
                appeals =
                    state.appeals
            in
            { state | appeals = { appeals | listing = stopLoading appeals.listing } }

        Content ->
            { state | filters = stopLoading state.filters }

        Abuse ->
            { state | sessions = stopLoading state.sessions, clones = (\c -> { c | loading = False }) state.clones }

        _ ->
            state


addCloneMember : OperReply.CloneMember -> Clones -> Clones
addCloneMember member clones =
    case clones.groups of
        group :: rest ->
            { clones | groups = { group | members = group.members ++ [ member ] } :: rest }

        [] ->
            clones


applyReply : Ctx -> Reply -> State -> State
applyReply ctx reply state =
    if not ctx.isOper then
        applyUserReply reply state

    else
        let
            now =
                ctx.nowMs

            logIt section =
                pushLog now section (OperReply.toneOf reply) (OperReply.describe reply)

            appeals =
                state.appeals
        in
        case reply of
            WardRow ward ->
                { state | wards = addRow ward state.wards }

            WardEnd ->
                { state | wards = finishListing now state.wards }

            ShunRow shun ->
                { state | shuns = addRow shun state.shuns }

            ShunEnd ->
                { state | shuns = finishListing now state.shuns }

            FilterRow row ->
                { state | filters = addRow row state.filters }

            FilterEnd _ ->
                { state | filters = finishListing now state.filters }

            SessionRow row ->
                { state | sessions = addRow row state.sessions }

            SessionsEnd ->
                { state | sessions = finishListing now state.sessions }

            AppealRow row ->
                { state | appeals = { appeals | listing = addRow row appeals.listing } }

            AppealNone ->
                logIt Appeals { state | appeals = { appeals | listing = finishListing now (startLoading appeals.listing) } }

            AbuseFact fact ->
                let
                    facts =
                        case state.abuse of
                            Just current ->
                                if current.nick == fact.nick then
                                    current.facts ++ [ ( fact.topic, fact.detail ) ]

                                else
                                    [ ( fact.topic, fact.detail ) ]

                            Nothing ->
                                [ ( fact.topic, fact.detail ) ]
                in
                { state | abuse = Just { nick = fact.nick, facts = List.take 12 facts } }

            ClonesPolicy text ->
                let
                    clones =
                        state.clones
                in
                { state | clones = { clones | policy = List.take 6 (clones.policy ++ [ text ]), loadedAtMs = Just now } }

            ClonesHeader header ->
                let
                    clones =
                        state.clones
                in
                { state | clones = { clones | groups = List.take 40 (clones.groups ++ [ { header = header, members = [] } ]), loading = False, none = False, loadedAtMs = Just now } }

            ClonesNone ->
                let
                    clones =
                        state.clones
                in
                { state | clones = { clones | groups = [], none = True, loading = False, loadedAtMs = Just now } }

            SpamtrapSummary summary ->
                { state | spamtrap = Just summary }

            PolicyGenerations gens ->
                { state | policy = Just gens }

            PrivilegeList list ->
                { state | privileges = Just list }

            EventCategories e ->
                { state
                    | subscribed = Just e.subscribed
                    , floor =
                        if e.minSeverity == "" then
                            state.floor

                        else
                            Just e.minSeverity
                }

            EventSeverityIs text ->
                let
                    next =
                        severityIn text
                in
                { state | floor = orElse next state.floor }

            EventStatsText _ ->
                state

            GagSet _ ->
                logIt Silence state

            QuarantineMoved ->
                logIt Silence state

            Denied _ ->
                answerToAsk ctx reply state

            NeedParams _ ->
                answerToAsk ctx reply state

            NoSuchNick _ ->
                answerToAsk ctx reply state

            Failed f ->
                finishClaimed ctx (extendClaim ctx (logIt (OperReply.sectionOf (Failed f)) state))

            SecondOperator ->
                answerToAsk ctx reply state

            RehashDone _ ->
                logIt Network state

            Said s ->
                let
                    sectionNow =
                        if s.section == Network && ctx.nowMs <= state.claimUntilMs then
                            state.claimSection

                        else
                            s.section
                in
                extendClaim ctx (pushLog now sectionNow (OperReply.toneOf reply) s.text state)

            _ ->
                -- Tests, filings, answers and the rest: one plain sentence
                -- in the section the reply belongs to.
                logIt (OperReply.sectionOf reply) state


{-| A refusal or a "waiting" that names no tab of its own belongs to
the command just sent: inside the reply window it is logged there (and
ends whatever that tab was loading); outside it, it is someone else's
and the desk ignores it. -}
answerToAsk : Ctx -> Reply -> State -> State
answerToAsk ctx reply state =
    if ctx.nowMs <= state.claimUntilMs then
        finishClaimed ctx
            (extendClaim ctx
                (pushLog ctx.nowMs state.claimSection (OperReply.toneOf reply) (OperReply.describe reply) state)
            )

    else
        state


severityIn : String -> Maybe String
severityIn text =
    OperFeed.severities
        |> List.filter (\s -> String.contains (" " ++ s) text && (String.endsWith s text || String.contains (s ++ " ") text || String.contains (s ++ "(") text))
        |> List.reverse
        |> List.head


orElse : Maybe a -> Maybe a -> Maybe a
orElse next current =
    case next of
        Just _ ->
            next

        Nothing ->
            current


{-| A person who is not an operator reads exactly one thing: the answer
to the appeal they filed. -}
applyUserReply : Reply -> State -> State
applyUserReply reply state =
    case ( state.userAppeal, reply ) of
        ( AppealSending, AppealFiled id ) ->
            { state | userAppeal = AppealFiledAs id }

        ( AppealSending, AppealAlready ) ->
            { state | userAppeal = AppealRefused "An appeal from this connection is already on file. The network accepts one an hour." }

        ( AppealSending, Said s ) ->
            if s.section == Appeals then
                { state | userAppeal = AppealRefused "The network could not file that appeal. Try again in a moment." }

            else
                state

        ( AppealSending, Failed f ) ->
            if f.command == "APPEAL" then
                { state | userAppeal = AppealRefused f.text }

            else
                state

        _ ->
            state



-- EVENT STATS


decodeStats : String -> Maybe SpineStats
decodeStats text =
    let
        counts =
            Decode.dict Decode.int
                |> Decode.map (\d -> Dict.toList d)

        decoder =
            Decode.map4 SpineStats
                (Decode.field "total" Decode.int)
                (Decode.field "history_depth" Decode.int)
                (Decode.field "categories" counts)
                (Decode.field "severities" counts)
    in
    Decode.decodeString decoder text |> Result.toMaybe


{-| One short line for the abuse card header. -}
abuseHeadline : { nick : String, facts : List ( String, String ) } -> String
abuseHeadline abuse =
    let
        flagged ( topic, detail ) =
            case topic of
                "shun" ->
                    detail == "yes"

                "dnsbl" ->
                    String.startsWith "listed" detail

                "flood" ->
                    detail /= "none" && not (String.startsWith "none" detail)

                _ ->
                    False
    in
    case List.filter flagged abuse.facts of
        [] ->
            abuse.nick ++ " shows no active throttling or listing."

        found ->
            abuse.nick ++ " is flagged: " ++ String.join ", " (List.map Tuple.first found) ++ "."


{-| DOM id of a tab button (focus moves to it after a key press). -}
tabId : Section -> String
tabId section =
    "oper-tab-" ++ String.toLower (OperReply.sectionLabel section)


{-| The keys the tab list handles (and prevents the default of). -}
tabKeyHandled : String -> Bool
tabKeyHandled key =
    List.member key [ "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End" ]
