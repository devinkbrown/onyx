module Chanserv exposing
    ( AccessEntry
    , AkickEntry
    , Ctx
    , DeleteStage(..)
    , Drafts
    , Effect(..)
    , FoldCtx
    , Knock
    , KnockState(..)
    , MaskEntry
    , MaskList
    , Msg(..)
    , Notice
    , RegInfo
    , Registration(..)
    , Rule
    , State
    , Tone(..)
    , accessLevels
    , accessOf
    , akickOf
    , beginDelete
    , blank
    , buildMlock
    , canManage
    , failCopy
    , fold
    , formatSeconds
    , infoLine
    , isFounder
    , joinRefusalCopy
    , knockLine
    , knockStateOf
    , listKinds
    , listOf
    , mlockLetters
    , modeListLine
    , noteSends
    , parseInfo
    , parseMlock
    , probe
    , propOf
    , registrationOf
    , reset
    , ruleGroups
    , seed
    , slowGapOf
    , slowPresets
    , slowExempt
    , slowVoiceExempt
    , slowWait
    , slowWaitMs
    , slowmodeCopy
    , statusOf
    , successorOf
    , tick
    , timedDurations
    , timedLetters
    , timedOf
    , update
    , validChannel
    , validMask
    , validToken
    , welcomeMax
    )

{-| v3/gap-chanserv — the pure core behind channel registration
services and the channel-operator tools the Onyx Server already ships
(SERVER_FEATURE_MAP §6.1, §7, §10, §11, §14, §15; §22 items 8, 9, 11,
17, 18 and 27-31):

  - `CHANNEL`/`CS` REGISTER, INFO, DROP, SET (MLOCK, KEEPTOPIC,
    TOPICLOCK, GUARD, PRIVATE, DESC, URL), ACCESS (account levels) and
    AKICK, plus the top-level `SUCCESSOR` and `LISTCHANS`. Every success
    reply is a server NOTICE (`handleChannel`, server.zig:47370) and a
    failure is `FAIL CHANNEL <code>` with no channel in it, so the
    channel comes from the last `CHANNEL` line this client sent
    (`noteSends`).
  - "Delete room" that knows whether the room is registered: `INFO`
    first, `DROP` only for a registered room, then the room is emptied
    (`+si`, then `CLEAR … USERS` for a founder or one `KICK` per member)
    and left. An unregistered room stops existing when its last member
    goes.
  - KNOCK in both directions (710 to hosts; 711/713/714 to the asker).
  - The `+Z`/`+e`/`+I` mask lists (728/729, 348/349, 346/347).
  - The `+f` forward target and `+j` join throttle. `324` never reports
    them, so they are only known from live `MODE` lines.
  - Server-side timed rules (`TEMPMODE`). The server accepts boolean
    flags only and refuses `b`, so timed blocks stay on the client timer.
  - Room welcome/goodbye (`PROP ONJOIN`/`ONPART`, delivered as
    `NOTICE <me> :[#c] text`) and slow mode (`PROP SLOWMODE`/`SLOWVOICE`;
    a refused send answers `404 … :Cannot send to channel (slowmode)`).

`update` and `fold` never touch `App.Model`: they return `Effect`s that
App interprets with its existing folds (raw lines, the optimistic
`writeChannelProp`, toasts, inbox rows and transcript system rows).

-}

import Dict exposing (Dict)
import Modes
import Set exposing (Set)
import Wire



-- TYPES


type Registration
    = RegUnknown
    | RegChecking
    | RegNone
    | RegSignedOut
    | Registered RegInfo


type alias RegInfo =
    { founder : String
    , mlock : String
    , topiclock : Bool
    , guard : Bool
    , private : Bool
    , desc : String
    , url : String
    }


type alias AccessEntry =
    { account : String
    , level : String
    }


type alias AkickEntry =
    { mask : String
    , reason : String
    }


type alias MaskEntry =
    { mask : String
    , setBy : String
    , setAt : Int
    }


type alias MaskList =
    { loading : Bool
    , loaded : Bool
    , entries : List MaskEntry
    , buffer : List MaskEntry
    }


type alias Knock =
    { id : Int
    , channel : String
    , nick : String
    , mask : String
    , reason : String
    , at : Float
    , invited : Bool
    }


type KnockState
    = KnockSending Float
    | KnockDelivered
    | KnockNoHosts
    | KnockRefused


type Tone
    = ToneOk
    | ToneError
    | ToneInfo


type alias Notice =
    { tone : Tone
    , text : String
    }


type DeleteStage
    = DeleteAwaitInfo
    | DeleteAwaitDrop


type alias PendingDelete =
    { channel : String
    , stage : DeleteStage
    , others : List String
    , founderRank : Bool
    }


type alias Listed a =
    { loading : Bool
    , entries : List a
    , buffer : List a
    }


type alias Drafts =
    { channel : String
    , desc : String
    , url : String
    , mlock : Dict Char String
    , accessAccount : String
    , accessLevel : String
    , akickMask : String
    , akickReason : String
    , successor : String
    , listMask : String
    , forward : String
    , throttleJoins : String
    , throttleSecs : String
    , welcome : String
    , goodbye : String
    , slow : String
    , slowVoice : Bool
    , timedLetter : String
    , timedMinutes : String
    , knockNote : String
    , joinKey : String
    }


type alias State =
    { reg : Dict String Registration
    , infoFor : Maybe String
    , autoLoad : Maybe String
    , keepTopic : Dict String Bool
    , access : Dict String (Listed AccessEntry)
    , akick : Dict String (Listed AkickEntry)
    , successor : Dict String (Maybe String)
    , myRooms : { loading : Bool, loaded : Bool, rooms : List AccessEntry, buffer : List AccessEntry }
    , lists : Dict String MaskList
    , forwards : Dict String String
    , throttles : Dict String String
    , timed : Dict String (List { letter : Char, until : Float })
    , knocks : List Knock
    , knockSeq : Int
    , knocked : Dict String KnockState
    , refusal : Dict String String
    , slowSent : Dict String Float
    , welcomeSeen : Dict String String
    , pendingDelete : Maybe PendingDelete
    , lastCs : Maybe { channel : String, sub : String, field : String }
    , lastSuccessor : Maybe String
    , lastModeTarget : Maybe String
    , status : Dict String Notice
    , drafts : Drafts
    , listTab : Char
    , confirmDrop : Bool
    }


blankDrafts : Drafts
blankDrafts =
    { channel = ""
    , desc = ""
    , url = ""
    , mlock = Dict.empty
    , accessAccount = ""
    , accessLevel = "OP"
    , akickMask = ""
    , akickReason = ""
    , successor = ""
    , listMask = ""
    , forward = ""
    , throttleJoins = ""
    , throttleSecs = ""
    , welcome = ""
    , goodbye = ""
    , slow = "0"
    , slowVoice = False
    , timedLetter = "m"
    , timedMinutes = "10"
    , knockNote = ""
    , joinKey = ""
    }


blank : State
blank =
    { reg = Dict.empty
    , infoFor = Nothing
    , autoLoad = Nothing
    , keepTopic = Dict.empty
    , access = Dict.empty
    , akick = Dict.empty
    , successor = Dict.empty
    , myRooms = { loading = False, loaded = False, rooms = [], buffer = [] }
    , lists = Dict.empty
    , forwards = Dict.empty
    , throttles = Dict.empty
    , timed = Dict.empty
    , knocks = []
    , knockSeq = 0
    , knocked = Dict.empty
    , refusal = Dict.empty
    , slowSent = Dict.empty
    , welcomeSeen = Dict.empty
    , pendingDelete = Nothing
    , lastCs = Nothing
    , lastSuccessor = Nothing
    , lastModeTarget = Nothing
    , status = Dict.empty
    , drafts = blankDrafts
    , listTab = 'Z'
    , confirmDrop = False
    }


{-| A socket close ends every in-flight request: loading marks clear,
an unanswered delete is abandoned, knocks still waiting for 711 lapse,
and registration is learned again on the next open (a reconnect may
land on another account).
-}
reset : State -> State
reset state =
    { state
        | reg = Dict.empty
        , infoFor = Nothing
        , autoLoad = Nothing
        , access = Dict.map (\_ l -> { l | loading = False, buffer = [] }) state.access
        , akick = Dict.map (\_ l -> { l | loading = False, buffer = [] }) state.akick
        , myRooms = { loading = False, loaded = False, rooms = [], buffer = [] }
        , lists = Dict.map (\_ l -> { l | loading = False, buffer = [] }) state.lists
        , knocked =
            Dict.filter
                (\_ k ->
                    case k of
                        KnockSending _ ->
                            False

                        _ ->
                            True
                )
                state.knocked
        , pendingDelete = Nothing
        , lastCs = Nothing
        , lastSuccessor = Nothing
        , welcomeSeen = Dict.empty
        , confirmDrop = False
    }


type alias Ctx =
    { room : Maybe String
    , live : Bool
    , isOp : Bool
    , isOper : Bool
    , account : Maybe String
    , props : Dict String String
    , modes : String
    , nowMs : Float
    }


type alias FoldCtx =
    { ourNick : String
    , nowMs : Float
    , isChannel : String -> Bool
    , inChannel : String -> Bool
    , groups : Modes.ArgGroups
    , prefixModes : Set Char
    }


type Effect
    = Send String
    | WriteProp { channel : String, key : String, value : String }
    | Toast Tone String (Maybe String)
    | Inbox { text : String, from : Maybe String, channel : Maybe String }
    | SystemRow String String
    | ClearJoinPrompt String


type Msg
    = Register
    | Refresh
    | DescInput String
    | DescSave
    | UrlInput String
    | UrlSave
    | MlockPick Char String
    | MlockSave
    | KeepTopicSet Bool
    | FlagSet String Bool
    | AccessAccountInput String
    | AccessLevelInput String
    | AccessAdd
    | AccessDel String String
    | AccessLoad
    | AkickMaskInput String
    | AkickReasonInput String
    | AkickAdd
    | AkickDel String
    | AkickLoad
    | SuccessorInput String
    | SuccessorSet
    | SuccessorClear
    | SuccessorLoad
    | MyRoomsLoad
    | DropAsk
    | DropCancel
    | DropConfirm
    | ListTab Char
    | ListLoad Char
    | ListMaskInput String
    | ListAdd
    | ListDel Char String
    | MuteMember String String
    | UnmuteMember String String
    | RuleToggle Char
    | ForwardInput String
    | ForwardSave
    | ForwardClear
    | ThrottleJoinsInput String
    | ThrottleSecsInput String
    | ThrottleSave
    | ThrottleClear
    | TimedLetterInput String
    | TimedMinutesInput String
    | TimedStart
    | TimedEnd Char
    | WelcomeInput String
    | WelcomeSave
    | GoodbyeInput String
    | GoodbyeSave
    | SlowInput String
    | SlowVoiceSet Bool
    | SlowSave
    | AskToJoin String
    | KnockNoteInput String
    | JoinKeyInput String
    | JoinWithKey String
    | DismissPrompt String
    | InviteKnock Int
    | DismissKnock Int



-- TABLES


type alias Rule =
    { letter : Char
    , label : String
    , hint : String
    , operOnly : Bool
    }


{-| The channel rules beyond the five everyday ones, in plain words
(never mode letters on screen). `E`/`r`/`z` are server markers and are
not offered; `O`/`A` are network-operator gates.
-}
ruleGroups : List { key : String, title : String, rules : List Rule }
ruleGroups =
    [ { key = "join"
      , title = "Who can join"
      , rules =
            [ Rule 'a' "Signed-in accounts only" "Guests without an Onyx account can't join." False
            , Rule 'S' "Secure connections only" "Only people on an encrypted (TLS) connection can join." False
            , Rule 'u' "Allow join requests" "People can ask to join while the room is invite-only." False
            , Rule 'g' "Members can invite" "Anyone in the room can invite people while it is invite-only." False
            , Rule 'd' "Overflow rooms when full" "When the member limit is reached, new people go to an automatic overflow room." False
            , Rule 'O' "Network operators only" "Only Onyx network operators can join." True
            , Rule 'A' "Network administrators only" "Only Onyx network administrators can join." True
            ]
      }
    , { key = "talk"
      , title = "Who can talk"
      , rules =
            [ Rule 'M' "Signed-in speakers only" "Guests need voice before they can send messages." False
            , Rule 'N' "Lock nicknames" "Members can't change their name while they're here." False
            , Rule 'w' "No whispers" "Members can't whisper to each other inside the room." False
            , Rule 'T' "No notices" "Only hosts can send notices to the room." False
            , Rule 'C' "No automated client requests" "Blocks client-to-client requests such as version checks." False
            , Rule 'V' "No data messages" "Refuses app and bot data messages in the room." False
            , Rule 'U' "Show held messages to hosts" "Messages the rules would refuse go to the hosts instead of vanishing." False
            , Rule 'W' "News commands" "Lets people use !news and !localnews here." False
            ]
      }
    , { key = "see"
      , title = "Who can see"
      , rules =
            [ Rule 'p' "Private member list" "Only people in the room can see who is here." False
            , Rule 'h' "Hidden from room lists" "The room stays out of room lists and name lookups." False
            , Rule 'x' "Auditorium" "Members see the hosts, not each other." False
            ]
      }
    , { key = "forward"
      , title = "Forwarding"
      , rules =
            [ Rule 'F' "Accept forwarded people" "Hosts of other rooms may forward people here." False
            , Rule 'D' "Refuse forwarded people" "Other rooms can't send people here." False
            ]
      }
    ]


{-| `TEMPMODE` takes boolean flags only (`channelFlagFromLetter`,
server.zig:9719); these are the useful ones, in words.
-}
timedLetters : List ( Char, String )
timedLetters =
    [ ( 'm', "Moderated (only voiced people talk)" )
    , ( 'i', "Invite only" )
    , ( 'M', "Signed-in speakers only" )
    , ( 'N', "Lock nicknames" )
    , ( 't', "Topic locked" )
    , ( 's', "Secret" )
    ]


timedDurations : List ( Int, String )
timedDurations =
    [ ( 5, "5 minutes" )
    , ( 10, "10 minutes" )
    , ( 30, "30 minutes" )
    , ( 60, "1 hour" )
    , ( 180, "3 hours" )
    , ( 720, "12 hours" )
    , ( 1440, "1 day" )
    ]


slowPresets : List ( Int, String )
slowPresets =
    [ ( 0, "Off" )
    , ( 5, "5 seconds" )
    , ( 10, "10 seconds" )
    , ( 30, "30 seconds" )
    , ( 60, "1 minute" )
    , ( 120, "2 minutes" )
    , ( 300, "5 minutes" )
    , ( 900, "15 minutes" )
    , ( 3600, "1 hour" )
    ]


slowmodeMaxSecs : Int
slowmodeMaxSecs =
    86400


{-| `ONJOIN`/`ONPART` cap (`ircx_prop_store` max_value 255). -}
welcomeMax : Int
welcomeMax =
    255


descMax : Int
descMax =
    400


{-| Rules a founder can lock (`CHANNEL SET MLOCK`). -}
mlockLetters : List ( Char, String )
mlockLetters =
    [ ( 'i', "Invite only" )
    , ( 'm', "Moderated" )
    , ( 'n', "No external messages" )
    , ( 't', "Topic locked" )
    , ( 's', "Secret" )
    , ( 'M', "Signed-in speakers only" )
    , ( 'a', "Signed-in accounts only" )
    , ( 'S', "Secure connections only" )
    ]


{-| Account levels `CHANNEL ACCESS ADD` grants (AKICK lives under
`CHANNEL AKICK`).
-}
accessLevels : List ( String, String )
accessLevels =
    [ ( "OP", "Host" )
    , ( "VOICE", "Voice" )
    , ( "FOUNDER", "Founder" )
    ]


listKinds : List { letter : Char, tab : String, hint : String, add : String, empty : String }
listKinds =
    [ { letter = 'Z', tab = "Muted", hint = "Muted people stay in the room but can't send messages.", add = "Mute", empty = "No one is muted." }
    , { letter = 'e', tab = "Ban exceptions", hint = "These masks can join and talk even when a block matches them.", add = "Add exception", empty = "No ban exceptions." }
    , { letter = 'I', tab = "Invite exceptions", hint = "These masks can join while the room is invite-only.", add = "Add exception", empty = "No invite exceptions." }
    ]



-- VALIDATION + BUILDERS


validChannel : String -> Bool
validChannel channel =
    case String.uncons channel of
        Just ( c, rest ) ->
            (c == '#' || c == '&')
                && not (String.isEmpty rest)
                && (String.length channel <= 200)
                && not (String.any (\x -> x == ' ' || x == ',' || Char.toCode x < 32 || Char.toCode x == 127) channel)

        Nothing ->
            False


validToken : Int -> String -> Bool
validToken maxLen token =
    not (String.isEmpty token)
        && (String.length token <= maxLen)
        && not (String.any (\c -> c == ' ' || Char.toCode c < 32 || Char.toCode c == 127) token)
        && not (String.startsWith ":" token)


validMask : String -> Bool
validMask =
    validToken 256


cleanText : String -> String
cleanText raw =
    raw
        |> String.map
            (\c ->
                if Char.toCode c < 32 || Char.toCode c == 127 then
                    ' '

                else
                    c
            )
        |> String.trim


{-| A bare name becomes `name!*@*`; a mask, extban or `account:` stays. -}
expandMask : String -> Maybe String
expandMask raw =
    let
        t =
            String.trim raw
    in
    if not (validMask t) then
        Nothing

    else if String.contains "!" t || String.contains "@" t || String.startsWith "$" t || String.contains ":" t then
        Just t

    else
        Just (t ++ "!*@*")


cs : String -> String -> List String -> String
cs sub channel rest =
    Wire.formatIrcLine "CHANNEL" (sub :: channel :: rest)


infoLine : String -> String
infoLine channel =
    cs "INFO" channel []


knockLine : String -> String -> String
knockLine channel note =
    case cleanText note of
        "" ->
            Wire.formatIrcLine "KNOCK" [ channel ]

        n ->
            Wire.formatIrcLine "KNOCK" [ channel, String.left 200 n ]


modeListLine : String -> Char -> String
modeListLine channel letter =
    Wire.formatIrcLine "MODE" [ channel, "+" ++ String.fromChar letter ]



-- SELECTORS


key : String -> String
key =
    String.toLower


listKey : String -> Char -> String
listKey channel letter =
    key channel ++ " " ++ String.fromChar letter


registrationOf : String -> State -> Registration
registrationOf channel state =
    Maybe.withDefault RegUnknown (Dict.get (key channel) state.reg)


accessOf : String -> State -> { loading : Bool, entries : List AccessEntry }
accessOf channel state =
    case Dict.get (key channel) state.access of
        Just l ->
            { loading = l.loading, entries = l.entries }

        Nothing ->
            { loading = False, entries = [] }


akickOf : String -> State -> { loading : Bool, entries : List AkickEntry }
akickOf channel state =
    case Dict.get (key channel) state.akick of
        Just l ->
            { loading = l.loading, entries = l.entries }

        Nothing ->
            { loading = False, entries = [] }


successorOf : String -> State -> Maybe (Maybe String)
successorOf channel state =
    Dict.get (key channel) state.successor


listOf : String -> Char -> State -> MaskList
listOf channel letter state =
    Maybe.withDefault { loading = False, loaded = False, entries = [], buffer = [] } (Dict.get (listKey channel letter) state.lists)


knockStateOf : String -> State -> Maybe KnockState
knockStateOf channel state =
    Dict.get (key channel) state.knocked


timedOf : String -> State -> List { letter : Char, until : Float }
timedOf channel state =
    Maybe.withDefault [] (Dict.get (key channel) state.timed)


statusOf : String -> String -> State -> Maybe Notice
statusOf channel area state =
    Dict.get (key channel ++ "|" ++ area) state.status


{-| Case-insensitive prop lookup (keys keep the case they were set in). -}
propOf : String -> Dict String String -> Maybe String
propOf name props =
    case Dict.get name props of
        Just v ->
            Just v

        Nothing ->
            let
                upper =
                    String.toUpper name
            in
            Dict.foldl
                (\k v acc ->
                    case acc of
                        Just _ ->
                            acc

                        Nothing ->
                            if String.toUpper k == upper then
                                Just v

                            else
                                Nothing
                )
                Nothing
                props


{-| The `SLOWMODE` gap in seconds, read like `channelSlowmodeGapMs`: a
whole number in 1..86400, else off.
-}
slowGapOf : Dict String String -> Int
slowGapOf props =
    case Maybe.andThen (String.trim >> String.toInt) (propOf "SLOWMODE" props) of
        Just secs ->
            if secs <= 0 || secs > slowmodeMaxSecs then
                0

            else
                secs

        Nothing ->
            0


{-| Voice and hosts skip the gap unless `SLOWVOICE` is exactly "0". -}
slowVoiceExempt : Dict String String -> Bool
slowVoiceExempt props =
    propOf "SLOWVOICE" props /= Just "0"


{-| Milliseconds left before this client may send in `channel` again. -}
slowWaitMs : Int -> Float -> String -> State -> Int
slowWaitMs gapSecs nowMs channel state =
    if gapSecs <= 0 then
        0

    else
        case Dict.get (key channel) state.slowSent of
            Just at ->
                max 0 (round (at + toFloat gapSecs * 1000 - nowMs))

            Nothing ->
                0


{-| Who skips the gap (`slowmodeDenies`): network operators always;
voice and above unless `SLOWVOICE` is "0".
-}
slowExempt : { props : Dict String String, selfModes : List Char, isOper : Bool } -> Bool
slowExempt input =
    input.isOper
        || (slowVoiceExempt input.props
                && List.any (\c -> Modes.statusRank c >= Modes.statusRank 'v') input.selfModes
           )


{-| Milliseconds this sender still has to wait in `channel` (0 when slow
mode is off, the sender is exempt, or the gap has passed).
-}
slowWait : { props : Dict String String, selfModes : List Char, isOper : Bool, nowMs : Float } -> String -> State -> Int
slowWait input channel state =
    if slowExempt { props = input.props, selfModes = input.selfModes, isOper = input.isOper } then
        0

    else
        slowWaitMs (slowGapOf input.props) input.nowMs channel state


isFounder : Maybe String -> RegInfo -> Bool
isFounder account info =
    case account of
        Just a ->
            String.toLower a == String.toLower info.founder

        Nothing ->
            False


{-| The registered founder, or an account `LISTCHANS` reports at
founder/admin level for this room.
-}
canManage : Maybe String -> String -> State -> Bool
canManage account channel state =
    case registrationOf channel state of
        Registered info ->
            isFounder account info
                || (account
                        /= Nothing
                        && List.any (\r -> key r.account == key channel && List.member (String.toUpper r.level) [ "FOUNDER", "ADMIN" ]) state.myRooms.rooms
                   )

        _ ->
            False


formatSeconds : Int -> String
formatSeconds secs =
    case List.filter (\( s, _ ) -> s == secs) slowPresets of
        ( _, label ) :: _ ->
            label

        [] ->
            if secs >= 3600 && modBy 3600 secs == 0 then
                plural (secs // 3600) "hour"

            else if secs >= 60 && modBy 60 secs == 0 then
                plural (secs // 60) "minute"

            else
                plural secs "second"


plural : Int -> String -> String
plural n word =
    String.fromInt n
        ++ " "
        ++ word
        ++ (if n == 1 then
                ""

            else
                "s"
           )


{-| `+nt-k` → per-letter "on"/"off". -}
parseMlock : String -> Dict Char String
parseMlock spec =
    String.foldl
        (\c ( sign, acc ) ->
            if c == '+' then
                ( "on", acc )

            else if c == '-' then
                ( "off", acc )

            else if Char.isAlpha c then
                ( sign, Dict.insert c sign acc )

            else
                ( sign, acc )
        )
        ( "on", Dict.empty )
        spec
        |> Tuple.second


{-| Per-letter picks → a `LockSpec` (`+on-off`), or nothing when no
rule is locked (the server rejects an empty spec).
-}
buildMlock : Dict Char String -> Maybe String
buildMlock picks =
    let
        pick state =
            Dict.toList picks |> List.filter (\( _, v ) -> v == state) |> List.map Tuple.first |> String.fromList

        on =
            pick "on"

        off =
            pick "off"

        spec =
            (if String.isEmpty on then
                ""

             else
                "+" ++ on
            )
                ++ (if String.isEmpty off then
                        ""

                    else
                        "-" ++ off
                   )
    in
    if String.isEmpty spec then
        Nothing

    else
        Just spec


{-| `channel=#c founder=a flags=3 mlock=+nt topiclock=true guard=false private=false` -}
parseInfo : String -> Maybe ( String, RegInfo )
parseInfo text =
    if not (String.startsWith "channel=" text) then
        Nothing

    else
        let
            pairs =
                String.words text
                    |> List.filterMap
                        (\w ->
                            case String.indexes "=" w of
                                at :: _ ->
                                    Just ( String.left at w, String.dropLeft (at + 1) w )

                                [] ->
                                    Nothing
                        )
                    |> Dict.fromList

            get k =
                Maybe.withDefault "" (Dict.get k pairs)
        in
        case ( Dict.get "channel" pairs, Dict.get "founder" pairs ) of
            ( Just channel, Just founder ) ->
                if validChannel channel && not (String.isEmpty founder) then
                    Just
                        ( channel
                        , { founder = founder
                          , mlock = get "mlock"
                          , topiclock = get "topiclock" == "true"
                          , guard = get "guard" == "true"
                          , private = get "private" == "true"
                          , desc = ""
                          , url = ""
                          }
                        )

                else
                    Nothing

            _ ->
                Nothing


{-| Plain copy for a `FAIL CHANNEL` / `FAIL SUCCESSOR` code (§15). -}
failCopy : String -> String -> String -> String
failCopy sub code description =
    case code of
        "ACCESS_DENIED" ->
            "Only the room's founder can do that."

        "ACCOUNT_REQUIRED" ->
            "Sign in to your Onyx account first."

        "BAD_CHANNEL_NAME" ->
            "That room name can't be registered."

        "CHANNEL_EXISTS" ->
            "This room is already registered."

        "CHANNEL_UNKNOWN" ->
            "This room isn't registered."

        "INVALID_PARAMS" ->
            if sub == "SET" then
                "The server didn't accept that value."

            else
                "The server didn't accept that request."

        "NEED_MORE_PARAMS" ->
            "Something was missing from that request."

        "TEMPORARILY_UNAVAILABLE" ->
            "Room services are busy. Try again in a moment."

        "AKICK_EXISTS" ->
            "That mask is already on the auto-kick list."

        "LIST_FULL" ->
            "That list is full."

        "NOT_FOUNDER" ->
            "Only the room's founder can choose a successor."

        "ACCOUNT_UNKNOWN" ->
            "There's no Onyx account with that name."

        "INVALID_VALUE" ->
            "The server didn't accept that value."

        _ ->
            if String.isEmpty description then
                "The server refused that (" ++ code ++ ")."

            else
                description


{-| Join-refusal copy by numeric: (title, body). Words, never modes. -}
joinRefusalCopy : String -> String -> String -> ( String, String )
joinRefusalCopy code channel serverText =
    case code of
        "471" ->
            ( channel ++ " is full", "It has reached its member limit." )

        "473" ->
            ( channel ++ " is invite-only", "A host has to invite you." )

        "474" ->
            ( "You can't join " ++ channel, "You're blocked from this room." )

        "475" ->
            ( channel ++ " needs a key", "Enter the room key, or ask the hosts to let you in." )

        "477" ->
            ( channel ++ " is for signed-in accounts", "Sign in to your Onyx account to join." )

        "480" ->
            ( channel ++ " is busy", "Too many people are joining right now. Try again in a moment." )

        "489" ->
            ( channel ++ " needs a secure connection", "This room only accepts encrypted (TLS) connections, and this connection doesn't qualify." )

        "520" ->
            if String.contains "(+A)" serverText then
                ( channel ++ " is for network administrators", "Only Onyx network administrators can join." )

            else
                ( channel ++ " is for network operators", "Only Onyx network operators can join." )

        _ ->
            ( "You can't join " ++ channel, serverText )


slowmodeCopy : String -> String
slowmodeCopy channel =
    "Slow mode is on in " ++ channel ++ ". Wait a moment, then send again."



-- STATE HELPERS


setStatus : String -> String -> Tone -> String -> State -> State
setStatus channel area tone text state =
    { state | status = Dict.insert (key channel ++ "|" ++ area) { tone = tone, text = text } state.status }


setDrafts : (Drafts -> Drafts) -> State -> State
setDrafts f state =
    { state | drafts = f state.drafts }


setReg : String -> Registration -> State -> State
setReg channel r state =
    { state | reg = Dict.insert (key channel) r state.reg }


mapInfo : String -> (RegInfo -> RegInfo) -> State -> State
mapInfo channel f state =
    case registrationOf channel state of
        Registered info ->
            setReg channel (Registered (f info)) state

        _ ->
            state


startLoad : String -> Dict String (Listed a) -> Dict String (Listed a)
startLoad channel dict =
    Dict.update (key channel)
        (\m ->
            case m of
                Just l ->
                    Just { l | loading = True, buffer = [] }

                Nothing ->
                    Just { loading = True, entries = [], buffer = [] }
        )
        dict


endLoad : String -> Dict String (Listed a) -> Dict String (Listed a)
endLoad channel dict =
    Dict.update (key channel) (Maybe.map (\l -> { l | loading = False, entries = l.buffer, buffer = [] })) dict


{-| Seed the drafts for a freshly opened Room settings sheet and ask the
server what it knows: registration for signed-in people, the selected
mask list for hosts.
-}
seed : Ctx -> State -> ( State, List Effect )
seed ctx state =
    case ctx.room of
        Nothing ->
            ( state, [] )

        Just channel ->
            let
                info =
                    case registrationOf channel state of
                        Registered i ->
                            Just i

                        _ ->
                            Nothing

                drafts =
                    { blankDrafts
                        | channel = channel
                        , desc = Maybe.withDefault "" (Maybe.map .desc info)
                        , url = Maybe.withDefault "" (Maybe.map .url info)
                        , mlock = Maybe.withDefault Dict.empty (Maybe.map (.mlock >> parseMlock) info)
                        , welcome = Maybe.withDefault "" (propOf "ONJOIN" ctx.props)
                        , goodbye = Maybe.withDefault "" (propOf "ONPART" ctx.props)
                        , slow = String.fromInt (slowGapOf ctx.props)
                        , slowVoice = not (slowVoiceExempt ctx.props)
                        , forward = Maybe.withDefault "" (Dict.get (key channel) state.forwards)
                        , timedLetter = state.drafts.timedLetter
                        , timedMinutes = state.drafts.timedMinutes
                        , knockNote = state.drafts.knockNote
                        , joinKey = state.drafts.joinKey
                    }

                base =
                    { state | drafts = drafts, confirmDrop = False }

                ( withInfo, infoFx ) =
                    if ctx.live && ctx.account /= Nothing then
                        ( { base
                            | autoLoad = Just (key channel)
                            , reg =
                                case registrationOf channel base of
                                    Registered _ ->
                                        base.reg

                                    _ ->
                                        Dict.insert (key channel) RegChecking base.reg
                          }
                        , [ Send (infoLine channel) ]
                        )

                    else
                        ( base, [] )

                ( withList, listFx ) =
                    if ctx.live && ctx.isOp then
                        loadList channel state.listTab withInfo

                    else
                        ( withInfo, [] )
            in
            ( withList, infoFx ++ listFx )


{-| Ask whether a room is registered (Room care opens it so a later
delete already knows). Signed-in, live callers only.
-}
probe : String -> State -> ( State, List Effect )
probe channel state =
    case registrationOf channel state of
        RegUnknown ->
            ( setReg channel RegChecking state, [ Send (infoLine channel) ] )

        _ ->
            ( state, [] )


loadList : String -> Char -> State -> ( State, List Effect )
loadList channel letter state =
    let
        current =
            listOf channel letter state
    in
    ( { state | lists = Dict.insert (listKey channel letter) { current | loading = True, buffer = [] } state.lists }
    , [ Send (modeListLine channel letter) ]
    )


{-| "Delete room" (Room care), registration-aware. Returns what to send
now; the rest follows from `fold` as INFO/DROP answer.
-}
beginDelete : { channel : String, signedIn : Bool, others : List String, founderRank : Bool } -> State -> ( State, List Effect )
beginDelete input state =
    let
        pending stage =
            Just { channel = input.channel, stage = stage, others = input.others, founderRank = input.founderRank }
    in
    case ( registrationOf input.channel state, input.signedIn ) of
        ( _, False ) ->
            -- A guest cannot have registered the room (CHANNEL needs an
            -- account), so there is nothing to drop.
            ( { state | pendingDelete = Nothing }, clearOut input )

        ( Registered _, True ) ->
            ( { state | pendingDelete = pending DeleteAwaitDrop }, [ Send (cs "DROP" input.channel []) ] )

        ( RegNone, True ) ->
            ( { state | pendingDelete = Nothing }, clearOut input )

        _ ->
            ( { state | pendingDelete = pending DeleteAwaitInfo }, [ Send (infoLine input.channel) ] )


{-| Empty the room, then leave: an unregistered room stops existing when
its last member goes. A founder clears it in one `CLEAR`; an owner kicks
each member.
-}
clearOut : { a | channel : String, others : List String, founderRank : Bool } -> List Effect
clearOut input =
    let
        reason =
            "Room deleted"

        kicks =
            if input.founderRank then
                -- No reason argument: Onyx Server re-assembles the line from
                -- its params and drops the colon, so any reason text would
                -- be read as an unknown option. The default reason is fine.
                [ Send (Wire.formatIrcLine "CLEAR" [ input.channel, "USERS" ]) ]

            else
                List.map (\nick -> Send (Wire.formatIrcLine "KICK" [ input.channel, nick, reason ])) input.others
    in
    Send (Wire.formatIrcLine "MODE" [ input.channel, "+si" ])
        :: kicks
        ++ [ Send (Wire.formatIrcLine "PART" [ input.channel, reason ])
           , Toast ToneOk ("Deleted " ++ input.channel) Nothing
           ]


{-| Prune timed rules that have passed and lapse knocks the server
never confirmed (711 arrives only when a host was told).
-}
tick : Float -> State -> State
tick nowMs state =
    let
        lapsed =
            Dict.map
                (\_ k ->
                    case k of
                        KnockSending at ->
                            if nowMs - at > 6000 then
                                KnockNoHosts

                            else
                                k

                        _ ->
                            k
                )
                state.knocked

        timed =
            state.timed
                |> Dict.map (\_ rows -> List.filter (\r -> r.until > nowMs) rows)
                |> Dict.filter (\_ rows -> not (List.isEmpty rows))
    in
    if lapsed == state.knocked && timed == state.timed then
        state

    else
        { state | knocked = lapsed, timed = timed }


{-| Watch what this client sends: slow-mode stamps, and which channel
the next `FAIL CHANNEL` / `SUCCESSOR:` / MLOCK notice is about.
`gapFor` answers 0 for an exempt sender.
-}
noteSends : { gapFor : String -> Int, nowMs : Float } -> List String -> State -> State
noteSends ctx lines state =
    List.foldl
        (\raw acc ->
            let
                m =
                    Wire.parseIrcMessage raw
            in
            case ( String.toUpper m.command, m.params ) of
                ( "PRIVMSG", target :: _ ) ->
                    if ctx.gapFor target > 0 then
                        { acc | slowSent = Dict.insert (key target) ctx.nowMs acc.slowSent }

                    else
                        acc

                ( "CHANNEL", sub :: channel :: rest ) ->
                    { acc | lastCs = Just { channel = channel, sub = String.toUpper sub, field = String.toUpper (Maybe.withDefault "" (List.head rest)) } }

                ( "CS", sub :: channel :: rest ) ->
                    { acc | lastCs = Just { channel = channel, sub = String.toUpper sub, field = String.toUpper (Maybe.withDefault "" (List.head rest)) } }

                ( "SUCCESSOR", channel :: _ ) ->
                    { acc | lastSuccessor = Just channel }

                ( "MODE", target :: _ :: _ ) ->
                    { acc | lastModeTarget = Just target }

                ( "TEMPMODE", _ :: channel :: _ ) ->
                    { acc | lastModeTarget = Just channel }

                ( "KNOCK", channel :: _ ) ->
                    { acc | knocked = Dict.insert (key channel) (KnockSending ctx.nowMs) acc.knocked }

                ( "LISTCHANS", _ ) ->
                    let
                        mine =
                            acc.myRooms
                    in
                    { acc | myRooms = { mine | loading = True, buffer = [] } }

                _ ->
                    acc
        )
        state
        lines



-- UPDATE (UI)


update : Ctx -> Msg -> State -> ( State, List Effect )
update ctx msg state =
    case msg of
        DescInput v ->
            ( setDrafts (\d -> { d | desc = v }) state, [] )

        UrlInput v ->
            ( setDrafts (\d -> { d | url = v }) state, [] )

        MlockPick letter v ->
            ( setDrafts
                (\d ->
                    { d
                        | mlock =
                            if v == "on" || v == "off" then
                                Dict.insert letter v d.mlock

                            else
                                Dict.remove letter d.mlock
                    }
                )
                state
            , []
            )

        AccessAccountInput v ->
            ( setDrafts (\d -> { d | accessAccount = v }) state, [] )

        AccessLevelInput v ->
            if List.any (\( l, _ ) -> l == v) accessLevels then
                ( setDrafts (\d -> { d | accessLevel = v }) state, [] )

            else
                ( state, [] )

        AkickMaskInput v ->
            ( setDrafts (\d -> { d | akickMask = v }) state, [] )

        AkickReasonInput v ->
            ( setDrafts (\d -> { d | akickReason = v }) state, [] )

        SuccessorInput v ->
            ( setDrafts (\d -> { d | successor = v }) state, [] )

        ListMaskInput v ->
            ( setDrafts (\d -> { d | listMask = v }) state, [] )

        ForwardInput v ->
            ( setDrafts (\d -> { d | forward = v }) state, [] )

        ThrottleJoinsInput v ->
            ( setDrafts (\d -> { d | throttleJoins = v }) state, [] )

        ThrottleSecsInput v ->
            ( setDrafts (\d -> { d | throttleSecs = v }) state, [] )

        TimedLetterInput v ->
            ( setDrafts (\d -> { d | timedLetter = v }) state, [] )

        TimedMinutesInput v ->
            ( setDrafts (\d -> { d | timedMinutes = v }) state, [] )

        WelcomeInput v ->
            ( setDrafts (\d -> { d | welcome = String.left welcomeMax v }) state, [] )

        GoodbyeInput v ->
            ( setDrafts (\d -> { d | goodbye = String.left welcomeMax v }) state, [] )

        SlowInput v ->
            ( setDrafts (\d -> { d | slow = v }) state, [] )

        SlowVoiceSet v ->
            ( setDrafts (\d -> { d | slowVoice = v }) state, [] )

        KnockNoteInput v ->
            ( setDrafts (\d -> { d | knockNote = String.left 200 v }) state, [] )

        JoinKeyInput v ->
            ( setDrafts (\d -> { d | joinKey = v }) state, [] )

        ListTab letter ->
            if List.any (\k -> k.letter == letter) listKinds then
                let
                    tabbed =
                        { state | listTab = letter }

                    current channel =
                        listOf channel letter tabbed
                in
                case ( ctx.room, ctx.live && ctx.isOp ) of
                    ( Just channel, True ) ->
                        if (current channel).loaded || (current channel).loading then
                            ( tabbed, [] )

                        else
                            loadList channel letter tabbed

                    _ ->
                        ( tabbed, [] )

            else
                ( state, [] )

        DropAsk ->
            ( { state | confirmDrop = True }, [] )

        DropCancel ->
            ( { state | confirmDrop = False }, [] )

        AskToJoin channel ->
            if ctx.live && validChannel channel then
                ( { state | knocked = Dict.insert (key channel) (KnockSending ctx.nowMs) state.knocked }
                , [ Send (knockLine channel state.drafts.knockNote) ]
                )

            else
                ( state, [] )

        JoinWithKey channel ->
            let
                k =
                    String.trim state.drafts.joinKey
            in
            if ctx.live && validChannel channel && validToken 64 k then
                ( setDrafts (\d -> { d | joinKey = "" }) state
                , [ ClearJoinPrompt channel, Send (Wire.formatIrcLine "JOIN" [ channel, k ]) ]
                )

            else
                ( state, [] )

        DismissPrompt channel ->
            ( { state | knocked = Dict.remove (key channel) state.knocked, refusal = Dict.remove (key channel) state.refusal }
            , [ ClearJoinPrompt channel ]
            )

        InviteKnock id ->
            case List.filter (\k -> k.id == id) state.knocks of
                k :: _ ->
                    if ctx.live && not k.invited then
                        ( { state
                            | knocks =
                                List.map
                                    (\x ->
                                        if x.id == id then
                                            { x | invited = True }

                                        else
                                            x
                                    )
                                    state.knocks
                          }
                        , [ Send (Wire.formatIrcLine "INVITE" [ k.nick, k.channel ])
                          , Toast ToneOk ("Invited " ++ k.nick ++ " to " ++ k.channel) Nothing
                          ]
                        )

                    else
                        ( state, [] )

                [] ->
                    ( state, [] )

        DismissKnock id ->
            ( { state | knocks = List.filter (\k -> k.id /= id) state.knocks }, [] )

        MuteMember channel nick ->
            if ctx.live && validChannel channel && validToken 64 nick then
                ( state
                , [ Send (Wire.formatIrcLine "MODE" [ channel, "+Z", nick ++ "!*@*" ])
                  , Toast ToneOk ("Muted " ++ nick ++ " in " ++ channel) (Just "They can stay, but can't send messages until you unmute them.")
                  ]
                )

            else
                ( state, [] )

        UnmuteMember channel nick ->
            if ctx.live && validChannel channel && validToken 64 nick then
                let
                    masks =
                        case mutedMasks channel nick state of
                            [] ->
                                [ nick ++ "!*@*" ]

                            found ->
                                found
                in
                ( state
                , List.map (\m -> Send (Wire.formatIrcLine "MODE" [ channel, "-Z", m ])) masks
                    ++ [ Toast ToneOk ("Unmuted " ++ nick) Nothing ]
                )

            else
                ( state, [] )

        _ ->
            case ( ctx.room, ctx.live ) of
                ( Just channel, True ) ->
                    roomAct ctx channel msg state

                _ ->
                    ( state, [] )


{-| Quiet-list masks that name this nick (`nick!…`). -}
mutedMasks : String -> String -> State -> List String
mutedMasks channel nick state =
    (listOf channel 'Z' state).entries
        |> List.map .mask
        |> List.filter (\m -> String.toLower (nickOfMask m) == String.toLower nick)


nickOfMask : String -> String
nickOfMask mask =
    case String.indexes "!" mask of
        at :: _ ->
            String.left at mask

        [] ->
            mask


{-| Everything here acts on the open room over a live socket. -}
roomAct : Ctx -> String -> Msg -> State -> ( State, List Effect )
roomAct ctx channel msg state =
    let
        info =
            case registrationOf channel state of
                Registered i ->
                    Just i

                _ ->
                    Nothing

        founderOnly area f =
            if canManage ctx.account channel state then
                f ()

            else
                ( setStatus channel area ToneError "Only the room's founder can change this." state, [] )

        opOnly f =
            if ctx.isOp then
                f ()

            else
                ( state, [] )

        d =
            state.drafts
    in
    case msg of
        Register ->
            if ctx.isOp && ctx.account /= Nothing then
                ( setStatus channel "reg" ToneInfo "Registering…" state, [ Send (cs "REGISTER" channel []) ] )

            else
                ( state, [] )

        Refresh ->
            if ctx.account /= Nothing then
                ( { state | autoLoad = Just (key channel) }, [ Send (infoLine channel) ] )

            else
                ( state, [] )

        DescSave ->
            founderOnly "reg" <|
                \_ ->
                    let
                        v =
                            String.left descMax (cleanText d.desc)
                    in
                    -- The server's parser refuses an empty value, so a
                    -- description can be replaced but not blanked.
                    if String.isEmpty v || Just v == Maybe.map .desc info then
                        ( state, [] )

                    else
                        ( setStatus channel "reg" ToneInfo "Saving description…" state, [ Send (cs "SET" channel [ "DESC", v ]) ] )

        UrlSave ->
            founderOnly "reg" <|
                \_ ->
                    let
                        v =
                            cleanText d.url
                    in
                    if not (validToken 400 v) || Just v == Maybe.map .url info then
                        ( state, [] )

                    else
                        ( setStatus channel "reg" ToneInfo "Saving website…" state, [ Send (cs "SET" channel [ "URL", v ]) ] )

        MlockSave ->
            founderOnly "reg" <|
                \_ ->
                    case buildMlock d.mlock of
                        Just spec ->
                            if Just spec == Maybe.map .mlock info then
                                ( state, [] )

                            else
                                ( setStatus channel "reg" ToneInfo "Saving locked rules…" state, [ Send (cs "SET" channel [ "MLOCK", spec ]) ] )

                        Nothing ->
                            ( setStatus channel "reg" ToneError "Lock at least one rule. Onyx Server can't clear every lock at once." state, [] )

        KeepTopicSet on ->
            founderOnly "reg" <|
                \_ -> ( state, [ Send (cs "SET" channel [ "KEEPTOPIC", onOff on ]) ] )

        FlagSet field on ->
            founderOnly "reg" <|
                \_ ->
                    if List.member field [ "TOPICLOCK", "GUARD", "PRIVATE" ] then
                        ( state, [ Send (cs "SET" channel [ field, onOff on ]) ] )

                    else
                        ( state, [] )

        AccessLoad ->
            founderOnly "access" <|
                \_ -> ( { state | access = startLoad channel state.access }, [ Send (cs "ACCESS" channel [ "LIST" ]) ] )

        AccessAdd ->
            founderOnly "access" <|
                \_ ->
                    let
                        account =
                            String.trim d.accessAccount
                    in
                    if validToken 64 account && List.any (\( l, _ ) -> l == d.accessLevel) accessLevels then
                        ( setDrafts (\x -> { x | accessAccount = "" }) state
                        , [ Send (cs "ACCESS" channel [ "ADD", account, d.accessLevel ]) ]
                        )

                    else
                        ( setStatus channel "access" ToneError "Enter an Onyx account name." state, [] )

        AccessDel account level ->
            founderOnly "access" <|
                \_ ->
                    if validToken 64 account then
                        ( state, [ Send (cs "ACCESS" channel [ "DEL", account, accessWireLevel level ]) ] )

                    else
                        ( state, [] )

        AkickLoad ->
            founderOnly "akick" <|
                \_ -> ( { state | akick = startLoad channel state.akick }, [ Send (cs "AKICK" channel [ "LIST" ]) ] )

        AkickAdd ->
            founderOnly "akick" <|
                \_ ->
                    case expandMask d.akickMask of
                        Just mask ->
                            let
                                reason =
                                    String.left 200 (cleanText d.akickReason)
                            in
                            ( setDrafts (\x -> { x | akickMask = "", akickReason = "" }) state
                            , [ Send
                                    (cs "AKICK"
                                        channel
                                        ([ "ADD", mask ]
                                            ++ (if String.isEmpty reason then
                                                    []

                                                else
                                                    [ reason ]
                                               )
                                        )
                                    )
                              ]
                            )

                        Nothing ->
                            ( setStatus channel "akick" ToneError "Enter a name, a mask (name!user@host) or account:name." state, [] )

        AkickDel mask ->
            founderOnly "akick" <|
                \_ ->
                    if validMask mask then
                        ( state, [ Send (cs "AKICK" channel [ "DEL", mask ]) ] )

                    else
                        ( state, [] )

        SuccessorLoad ->
            if info /= Nothing then
                ( state, [ Send (Wire.formatIrcLine "SUCCESSOR" [ channel, "SHOW" ]) ] )

            else
                ( state, [] )

        SuccessorSet ->
            founderOnly "successor" <|
                \_ ->
                    let
                        account =
                            String.trim d.successor
                    in
                    if validToken 64 account then
                        ( setDrafts (\x -> { x | successor = "" }) state
                        , [ Send (Wire.formatIrcLine "SUCCESSOR" [ channel, "SET", account ]) ]
                        )

                    else
                        ( setStatus channel "successor" ToneError "Enter the Onyx account that should take over." state, [] )

        SuccessorClear ->
            founderOnly "successor" <|
                \_ -> ( state, [ Send (Wire.formatIrcLine "SUCCESSOR" [ channel, "CLEAR" ]) ] )

        MyRoomsLoad ->
            if ctx.account /= Nothing then
                let
                    mine =
                        state.myRooms
                in
                ( { state | myRooms = { mine | loading = True, buffer = [] } }, [ Send (Wire.formatIrcLine "LISTCHANS" []) ] )

            else
                ( state, [] )

        DropConfirm ->
            founderOnly "reg" <|
                \_ ->
                    ( setStatus channel "reg" ToneInfo "Dropping registration…" { state | confirmDrop = False }
                    , [ Send (cs "DROP" channel []) ]
                    )

        ListLoad letter ->
            opOnly <| \_ -> loadList channel letter state

        ListAdd ->
            opOnly <|
                \_ ->
                    case expandMask d.listMask of
                        Just mask ->
                            ( setDrafts (\x -> { x | listMask = "" }) state
                            , [ Send (Wire.formatIrcLine "MODE" [ channel, "+" ++ String.fromChar state.listTab, mask ]) ]
                            )

                        Nothing ->
                            ( setStatus channel "lists" ToneError "Enter a name or a mask like name!*@*." state, [] )

        ListDel letter mask ->
            opOnly <|
                \_ ->
                    if validMask mask && List.any (\k -> k.letter == letter) listKinds then
                        ( state, [ Send (Wire.formatIrcLine "MODE" [ channel, "-" ++ String.fromChar letter, mask ]) ] )

                    else
                        ( state, [] )

        RuleToggle letter ->
            opOnly <|
                \_ ->
                    let
                        flags =
                            (Modes.parseChannelModeString ctx.modes).flags
                    in
                    case List.filter (\r -> r.letter == letter) (List.concatMap .rules ruleGroups) of
                        r :: _ ->
                            if r.operOnly && not ctx.isOper then
                                ( state, [] )

                            else
                                ( state
                                , [ Send
                                        (Wire.formatIrcLine "MODE"
                                            [ channel
                                            , (if List.member letter flags then
                                                "-"

                                               else
                                                "+"
                                              )
                                                ++ String.fromChar letter
                                            ]
                                        )
                                  ]
                                )

                        [] ->
                            ( state, [] )

        ForwardSave ->
            opOnly <|
                \_ ->
                    let
                        target =
                            String.trim d.forward
                    in
                    if validChannel target && key target /= key channel then
                        ( setStatus channel "rules" ToneInfo ("Forwarding to " ++ target ++ "…") state
                        , [ Send (Wire.formatIrcLine "MODE" [ channel, "+f", target ]) ]
                        )

                    else
                        ( setStatus channel "rules" ToneError "Enter another room, like #overflow. You need to be a host there too." state, [] )

        ForwardClear ->
            opOnly <| \_ -> ( state, [ Send (Wire.formatIrcLine "MODE" [ channel, "-f" ]) ] )

        ThrottleSave ->
            opOnly <|
                \_ ->
                    case ( String.toInt (String.trim d.throttleJoins), String.toInt (String.trim d.throttleSecs) ) of
                        ( Just joins, Just secs ) ->
                            if joins >= 1 && joins <= 1000 && secs >= 1 && secs <= 86400 then
                                ( state, [ Send (Wire.formatIrcLine "MODE" [ channel, "+j", String.fromInt joins ++ ":" ++ String.fromInt secs ]) ] )

                            else
                                ( setStatus channel "rules" ToneError "Use 1 to 1000 joins over 1 to 86400 seconds." state, [] )

                        _ ->
                            ( setStatus channel "rules" ToneError "Enter how many joins, and over how many seconds." state, [] )

        ThrottleClear ->
            opOnly <| \_ -> ( state, [ Send (Wire.formatIrcLine "MODE" [ channel, "-j" ]) ] )

        TimedStart ->
            opOnly <|
                \_ ->
                    case ( String.uncons d.timedLetter, String.toInt d.timedMinutes ) of
                        ( Just ( letter, "" ), Just minutes ) ->
                            if List.any (\( l, _ ) -> l == letter) timedLetters && minutes >= 1 && minutes <= 10080 then
                                let
                                    rows =
                                        List.filter (\r -> r.letter /= letter) (timedOf channel state)
                                            ++ [ { letter = letter, until = ctx.nowMs + toFloat minutes * 60000 } ]
                                in
                                ( { state | timed = Dict.insert (key channel) rows state.timed }
                                    |> setStatus channel "rules" ToneOk ("On for " ++ formatMinutes minutes ++ ". Onyx Server turns it off, even if you close Onyx.")
                                , [ Send (Wire.formatIrcLine "TEMPMODE" [ "ADD", channel, "+" ++ String.fromChar letter, String.fromInt (minutes * 60000) ]) ]
                                )

                            else
                                ( state, [] )

                        _ ->
                            ( state, [] )

        TimedEnd letter ->
            opOnly <|
                \_ ->
                    ( { state | timed = Dict.insert (key channel) (List.filter (\r -> r.letter /= letter) (timedOf channel state)) state.timed }
                    , [ Send (Wire.formatIrcLine "TEMPMODE" [ "CANCEL", channel, String.fromChar letter ])
                      , Send (Wire.formatIrcLine "MODE" [ channel, "-" ++ String.fromChar letter ])
                      ]
                    )

        WelcomeSave ->
            opOnly <|
                \_ -> savePropText ctx channel "ONJOIN" d.welcome "Welcome message" state

        GoodbyeSave ->
            opOnly <|
                \_ -> savePropText ctx channel "ONPART" d.goodbye "Goodbye message" state

        SlowSave ->
            opOnly <|
                \_ ->
                    case String.toInt (String.trim d.slow) of
                        Just secs ->
                            if secs < 0 || secs > slowmodeMaxSecs then
                                ( state, [] )

                            else
                                let
                                    gapFx =
                                        if secs == slowGapOf ctx.props then
                                            []

                                        else
                                            [ WriteProp
                                                { channel = channel
                                                , key = "SLOWMODE"
                                                , value =
                                                    if secs == 0 then
                                                        ""

                                                    else
                                                        String.fromInt secs
                                                }
                                            ]

                                    voiceFx =
                                        if d.slowVoice == not (slowVoiceExempt ctx.props) then
                                            []

                                        else
                                            [ WriteProp
                                                { channel = channel
                                                , key = "SLOWVOICE"
                                                , value =
                                                    if d.slowVoice then
                                                        "0"

                                                    else
                                                        ""
                                                }
                                            ]
                                in
                                if List.isEmpty (gapFx ++ voiceFx) then
                                    ( state, [] )

                                else
                                    ( setStatus channel
                                        "pace"
                                        ToneOk
                                        (if secs == 0 then
                                            "Slow mode is off."

                                         else
                                            "Slow mode: one message every " ++ formatSeconds secs ++ "."
                                        )
                                        state
                                    , gapFx ++ voiceFx
                                    )

                        Nothing ->
                            ( state, [] )

        _ ->
            ( state, [] )


savePropText : Ctx -> String -> String -> String -> String -> State -> ( State, List Effect )
savePropText ctx channel prop draft label state =
    let
        v =
            String.left welcomeMax (cleanText draft)
    in
    if v == Maybe.withDefault "" (propOf prop ctx.props) then
        ( state, [] )

    else
        ( setStatus channel
            "pace"
            ToneOk
            (if String.isEmpty v then
                label ++ " removed."

             else
                label ++ " saved."
            )
            state
        , [ WriteProp { channel = channel, key = prop, value = v } ]
        )


formatMinutes : Int -> String
formatMinutes minutes =
    case List.filter (\( m, _ ) -> m == minutes) timedDurations of
        ( _, label ) :: _ ->
            label

        [] ->
            plural minutes "minute"


onOff : Bool -> String
onOff on =
    if on then
        "on"

    else
        "off"


{-| `ACCESS DEL` takes the parser's levels; an ADMIN row (shown, not
grantable) is removed at the founder tier.
-}
accessWireLevel : String -> String
accessWireLevel level =
    case String.toUpper level of
        "VOICE" ->
            "VOICE"

        "OP" ->
            "OP"

        _ ->
            "FOUNDER"



-- FOLD (inbound)


{-| Fold one inbound line. Unrelated lines leave the state unchanged and
produce no effects.
-}
fold : FoldCtx -> Wire.IrcMessage -> State -> ( State, List Effect )
fold ctx m state =
    case m.command of
        "NOTICE" ->
            case ( m.nick, m.params ) of
                ( Nothing, [ target, text ] ) ->
                    if String.toLower target == String.toLower ctx.ourNick || target == "*" then
                        foldServerNotice ctx text state

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        "FAIL" ->
            case m.params of
                command :: code :: rest ->
                    foldFail (String.toUpper command) code (Maybe.withDefault "" (List.head (List.reverse rest))) state

                _ ->
                    ( state, [] )

        "MODE" ->
            ( foldMode ctx m state, [] )

        "404" ->
            case m.params of
                _ :: channel :: text :: _ ->
                    if String.contains "(slowmode)" text then
                        ( { state | slowSent = Dict.insert (key channel) ctx.nowMs state.slowSent }, [] )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        "710" ->
            case m.params of
                _ :: channel :: mask :: rest ->
                    let
                        nick =
                            nickOfMask mask

                        reason =
                            Maybe.withDefault "" (List.head rest)

                        knock =
                            { id = state.knockSeq
                            , channel = channel
                            , nick = nick
                            , mask = mask
                            , reason = reason
                            , at = ctx.nowMs
                            , invited = False
                            }

                        kept =
                            List.filter (\k -> not (key k.channel == key channel && key k.nick == key nick)) state.knocks
                    in
                    if validChannel channel && validToken 64 nick then
                        ( { state | knocks = List.take 20 (knock :: kept), knockSeq = state.knockSeq + 1 }
                        , [ Inbox { text = nick ++ " asks to join " ++ channel, from = Just nick, channel = Just channel }
                          , Toast ToneInfo (nick ++ " asks to join " ++ channel) (Just "Open the inbox to invite them.")
                          ]
                        )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        "711" ->
            case m.params of
                _ :: channel :: _ ->
                    ( { state | knocked = Dict.insert (key channel) KnockDelivered state.knocked }
                    , [ Toast ToneOk ("Asked to join " ++ channel) (Just "The hosts were told. They can invite you in.") ]
                    )

                _ ->
                    ( state, [] )

        "713" ->
            case m.params of
                _ :: channel :: _ ->
                    ( { state | knocked = Dict.insert (key channel) KnockRefused state.knocked }
                    , [ Toast ToneError (channel ++ " doesn't take join requests") (Just "Ask someone in the room for an invite or the key.") ]
                    )

                _ ->
                    ( state, [] )

        "714" ->
            case m.params of
                _ :: channel :: _ ->
                    ( { state | knocked = Dict.remove (key channel) state.knocked }
                    , [ ClearJoinPrompt channel, Toast ToneInfo ("You're already in " ++ channel) Nothing ]
                    )

                _ ->
                    ( state, [] )

        "728" ->
            ( listRow 'Z' m state, [] )

        "729" ->
            ( listEnd 'Z' m state, [] )

        "348" ->
            ( listRow 'e' m state, [] )

        "349" ->
            ( listEnd 'e' m state, [] )

        "346" ->
            ( listRow 'I' m state, [] )

        "347" ->
            ( listEnd 'I' m state, [] )

        "421" ->
            case ( m.params, state.lastModeTarget ) of
                ( _ :: verb :: _, Just channel ) ->
                    if String.toUpper verb == "TEMPMODE" then
                        ( { state | timed = Dict.remove (key channel) state.timed }
                            |> setStatus channel "rules" ToneError "Timed rules aren't available on this server."
                        , []
                        )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        "JOIN" ->
            -- Our own JOIN settles any knock or refusal for that room.
            case ( m.nick, m.params ) of
                ( Just nick, channel :: _ ) ->
                    if key nick == key ctx.ourNick then
                        ( { state | knocked = Dict.remove (key channel) state.knocked, refusal = Dict.remove (key channel) state.refusal }, [] )

                    else
                        ( state, [] )

                _ ->
                    ( state, [] )

        _ ->
            if List.member m.command [ "471", "473", "474", "475", "477", "480", "489", "520" ] then
                case m.params of
                    _ :: channel :: _ ->
                        if ctx.isChannel channel then
                            ( { state | refusal = Dict.insert (key channel) m.command state.refusal }, [] )

                        else
                            ( state, [] )

                    _ ->
                        ( state, [] )

            else
                ( state, [] )


listRow : Char -> Wire.IrcMessage -> State -> State
listRow letter m state =
    case m.params of
        _ :: channel :: rest ->
            let
                -- Some servers put the list letter before the mask.
                fields =
                    case rest of
                        single :: more ->
                            if String.length single == 1 && not (List.isEmpty more) then
                                more

                            else
                                rest

                        [] ->
                            []
            in
            case fields of
                mask :: more ->
                    if validMask mask then
                        let
                            entry =
                                { mask = mask
                                , setBy = Maybe.withDefault "" (List.head more)
                                , setAt = Maybe.withDefault 0 (Maybe.andThen String.toInt (List.head (List.drop 1 more)))
                                }

                            current =
                                listOf channel letter state

                            next =
                                if current.loading then
                                    { current | buffer = current.buffer ++ [ entry ] }

                                else
                                    { current | loading = True, buffer = [ entry ] }
                        in
                        { state | lists = Dict.insert (listKey channel letter) next state.lists }

                    else
                        state

                [] ->
                    state

        _ ->
            state


listEnd : Char -> Wire.IrcMessage -> State -> State
listEnd letter m state =
    case m.params of
        _ :: channel :: _ ->
            { state | lists = Dict.insert (listKey channel letter) { loading = False, loaded = True, entries = (listOf channel letter state).buffer, buffer = [] } state.lists }

        _ ->
            state


{-| Live `MODE` lines keep the mask lists and the `+f`/`+j` values
current (324 never reports `f`/`j`).
-}
foldMode : FoldCtx -> Wire.IrcMessage -> State -> State
foldMode ctx m state =
    case m.params of
        channel :: modes :: args ->
            if not (ctx.isChannel channel) then
                state

            else
                let
                    step c ( adding, rest, acc ) =
                        if c == '+' then
                            ( True, rest, acc )

                        else if c == '-' then
                            ( False, rest, acc )

                        else
                            let
                                ( arg, remaining ) =
                                    if Modes.modeConsumesArg ctx.groups ctx.prefixModes c adding then
                                        ( List.head rest, List.drop 1 rest )

                                    else
                                        ( Nothing, rest )
                            in
                            ( adding, remaining, applyModeChange channel c adding arg acc )

                    ( _, _, next ) =
                        String.foldl step ( True, args, state ) modes
                in
                next

        _ ->
            state


applyModeChange : String -> Char -> Bool -> Maybe String -> State -> State
applyModeChange channel c adding arg state =
    if c == 'f' then
        case ( adding, arg ) of
            ( True, Just target ) ->
                { state | forwards = Dict.insert (key channel) target state.forwards }

            ( False, _ ) ->
                { state | forwards = Dict.remove (key channel) state.forwards }

            _ ->
                state

    else if c == 'j' then
        case ( adding, arg ) of
            ( True, Just spec ) ->
                { state | throttles = Dict.insert (key channel) spec state.throttles }

            ( False, _ ) ->
                { state | throttles = Dict.remove (key channel) state.throttles }

            _ ->
                state

    else if List.member c [ 'Z', 'e', 'I' ] then
        case arg of
            Just mask ->
                let
                    current =
                        listOf channel c state

                    without =
                        List.filter (\e -> e.mask /= mask) current.entries
                in
                { state
                    | lists =
                        Dict.insert (listKey channel c)
                            { current
                                | entries =
                                    if adding then
                                        without ++ [ { mask = mask, setBy = "", setAt = 0 } ]

                                    else
                                        without
                            }
                            state.lists
                }

            Nothing ->
                state

    else if not adding then
        -- A rule switched off ends any timed rule armed for it.
        case Dict.get (key channel) state.timed of
            Just rows ->
                { state | timed = Dict.insert (key channel) (List.filter (\r -> r.letter /= c) rows) state.timed }

            Nothing ->
                state

    else
        state


foldFail : String -> String -> String -> State -> ( State, List Effect )
foldFail command code description state =
    if command == "CHANNEL" || command == "CS" then
        case state.lastCs of
            Just last ->
                foldChannelFail last code description state

            Nothing ->
                ( state, [ Toast ToneError (failCopy "" code description) Nothing ] )

    else if command == "SUCCESSOR" then
        case state.lastSuccessor of
            Just channel ->
                ( setStatus channel "successor" ToneError (failCopy "SUCCESSOR" code description) state, [] )

            Nothing ->
                ( state, [] )

    else
        ( state, [] )


foldChannelFail : { channel : String, sub : String, field : String } -> String -> String -> State -> ( State, List Effect )
foldChannelFail last code description state =
    let
        channel =
            last.channel

        copy =
            failCopy last.sub code description
    in
    case state.pendingDelete of
        Just pending ->
            if key pending.channel /= key channel then
                foldPlainFail last code copy state

            else
                case pending.stage of
                    DeleteAwaitInfo ->
                        if code == "CHANNEL_UNKNOWN" || code == "ACCOUNT_REQUIRED" then
                            -- Not registered (or not ours to ask): nothing to
                            -- drop, so empty the room and leave.
                            ( { state | pendingDelete = Nothing }
                                |> setReg channel
                                    (if code == "CHANNEL_UNKNOWN" then
                                        RegNone

                                     else
                                        RegSignedOut
                                    )
                            , clearOut pending
                            )

                        else
                            ( { state | pendingDelete = Nothing }, [ Toast ToneError ("Couldn't delete " ++ channel) (Just copy) ] )

                    DeleteAwaitDrop ->
                        ( { state | pendingDelete = Nothing }
                        , [ Toast ToneError
                                ("Couldn't delete " ++ channel)
                                (Just
                                    (if code == "ACCESS_DENIED" then
                                        "This room is registered to another account. Only its founder can delete it."

                                     else
                                        copy
                                    )
                                )
                          ]
                        )

        Nothing ->
            foldPlainFail last code copy state


foldPlainFail : { channel : String, sub : String, field : String } -> String -> String -> State -> ( State, List Effect )
foldPlainFail last code copy state =
    let
        channel =
            last.channel
    in
    if last.sub == "INFO" then
        -- INFO is a probe: an unregistered room is an answer, not an error.
        case code of
            "CHANNEL_UNKNOWN" ->
                ( setReg channel RegNone state, [] )

            "ACCOUNT_REQUIRED" ->
                ( setReg channel RegSignedOut state, [] )

            _ ->
                ( setReg channel RegUnknown state |> setStatus channel "reg" ToneError copy, [] )

    else
        let
            area =
                case last.sub of
                    "ACCESS" ->
                        "access"

                    "AKICK" ->
                        "akick"

                    _ ->
                        "reg"

            cleared =
                case last.sub of
                    "ACCESS" ->
                        { state | access = Dict.update (key channel) (Maybe.map (\l -> { l | loading = False })) state.access }

                    "AKICK" ->
                        { state | akick = Dict.update (key channel) (Maybe.map (\l -> { l | loading = False })) state.akick }

                    _ ->
                        state
        in
        ( setStatus channel area ToneError copy cleared
        , if last.sub == "REGISTER" && code == "CHANNEL_EXISTS" then
            -- Someone already holds it: learn who.
            [ Send (infoLine channel) ]

          else
            []
        )


{-| Server NOTICEs: services replies, ONJOIN/ONPART, MLOCK refusals,
TEMPMODE receipts and the no-standard-replies FAIL fallback.
-}
foldServerNotice : FoldCtx -> String -> State -> ( State, List Effect )
foldServerNotice ctx text state =
    if String.startsWith "[" text then
        foldPropMessage ctx text state

    else if String.startsWith "channel=" text then
        case parseInfo text of
            Just ( channel, info ) ->
                foldInfo channel info state

            Nothing ->
                ( state, [] )

    else if String.startsWith "  desc: " text then
        infoDetail (\v i -> { i | desc = v }) (String.dropLeft 8 text) state

    else if String.startsWith "  url: " text then
        infoDetail (\v i -> { i | url = v }) (String.dropLeft 7 text) state

    else if String.startsWith "FAIL " text then
        -- No standard-replies: `FAIL <CMD> <CODE>: <reason>`.
        case String.words text of
            _ :: command :: codeColon :: _ ->
                let
                    reason =
                        case String.indexes ": " text of
                            at :: _ ->
                                String.dropLeft (at + 2) text

                            [] ->
                                ""
                in
                foldFail (String.toUpper command)
                    (if String.endsWith ":" codeColon then
                        String.dropRight 1 codeColon

                     else
                        codeColon
                    )
                    reason
                    state

            _ ->
                ( state, [] )

    else
        foldServiceWords text (String.words text) state


infoDetail : (String -> RegInfo -> RegInfo) -> String -> State -> ( State, List Effect )
infoDetail set value state =
    case state.infoFor of
        Just channel ->
            ( mapInfo channel (set value) state |> seedInfoDrafts channel, [] )

        Nothing ->
            ( state, [] )


foldServiceWords : String -> List String -> State -> ( State, List Effect )
foldServiceWords text words state =
    case words of
        "Channel" :: channel :: "registered" :: "to" :: founder :: _ ->
            ( setReg channel (Registered { founder = founder, mlock = "", topiclock = False, guard = False, private = False, desc = "", url = "" }) state
                |> setStatus channel "reg" ToneOk ("Registered to " ++ founder ++ ".")
            , [ Send (infoLine channel)
              , Toast ToneOk (channel ++ " is registered") (Just "Its founder, rules and access list now outlast an empty room.")
              ]
            )

        [ "Channel", channel, "dropped" ] ->
            foldDropped channel state

        "Channel" :: channel :: "MLOCK" :: "set" :: "to" :: spec :: _ ->
            ( mapInfo channel (\i -> { i | mlock = spec }) state
                |> setStatus channel "reg" ToneOk "Locked rules saved."
            , []
            )

        [ "Channel", channel, "KEEPTOPIC", value ] ->
            ( { state | keepTopic = Dict.insert (key channel) (value == "on") state.keepTopic }
                |> setStatus channel
                    "reg"
                    ToneOk
                    (if value == "on" then
                        "The topic will be remembered."

                     else
                        "The topic won't be remembered."
                    )
            , []
            )

        [ "Channel", channel, "DESC", value ] ->
            if value == "cleared" then
                ( mapInfo channel (\i -> { i | desc = "" }) state |> setStatus channel "reg" ToneOk "Description cleared.", [] )

            else
                ( mapInfo channel (\i -> { i | desc = String.left descMax (cleanText state.drafts.desc) }) state
                    |> setStatus channel "reg" ToneOk "Description saved."
                , []
                )

        [ "Channel", channel, "URL", "cleared" ] ->
            ( mapInfo channel (\i -> { i | url = "" }) state |> setStatus channel "reg" ToneOk "Website cleared.", [] )

        "Channel" :: channel :: "URL" :: "set" :: "to" :: rest ->
            ( mapInfo channel (\i -> { i | url = String.join " " rest }) state |> setStatus channel "reg" ToneOk "Website saved.", [] )

        [ "Channel", channel, field, value ] ->
            let
                on =
                    value == "on"

                apply i =
                    case field of
                        "topiclock" ->
                            { i | topiclock = on }

                        "guard" ->
                            { i | guard = on }

                        _ ->
                            { i | private = on }
            in
            if List.member field [ "topiclock", "guard", "private" ] then
                ( mapInfo channel apply state |> setStatus channel "reg" ToneOk "Saved.", [] )

            else
                ( state, [] )

        "Channel" :: channel :: "founder" :: "transferred" :: "to" :: founder :: _ ->
            ( mapInfo channel (\i -> { i | founder = founder }) state, [] )

        "CHANNEL" :: "SET" :: _ ->
            case state.lastCs of
                Just last ->
                    ( setStatus last.channel "reg" ToneError "This server can't change that setting yet." state, [] )

                Nothing ->
                    ( state, [] )

        "ACCESS" :: "removed" :: channel :: account :: _ ->
            ( { state | access = Dict.update (key channel) (Maybe.map (\l -> { l | entries = List.filter (\e -> key e.account /= key account) l.entries })) state.access }
                |> setStatus channel "access" ToneOk ("Removed " ++ account ++ ".")
            , []
            )

        "ACCESS" :: "updated" :: channel :: _ ->
            ( { state | access = startLoad channel state.access }, [ Send (cs "ACCESS" channel [ "LIST" ]) ] )

        [ "ACCESS", channel, account, level ] ->
            let
                entry =
                    { account = account, level = level }

                current =
                    Maybe.withDefault { loading = False, entries = [], buffer = [] } (Dict.get (key channel) state.access)
            in
            if current.loading then
                ( { state | access = Dict.insert (key channel) { current | buffer = current.buffer ++ [ entry ] } state.access }, [] )

            else
                ( { state | access = Dict.insert (key channel) { current | entries = List.filter (\e -> key e.account /= key account) current.entries ++ [ entry ] } state.access }
                    |> setStatus channel "access" ToneOk (account ++ " is now " ++ levelWord level ++ ".")
                , []
                )

        "End" :: "of" :: "ACCESS" :: "list" :: "for" :: channel :: _ ->
            ( { state | access = endLoad channel state.access }, [] )

        "AKICK" :: "added" :: "on" :: channelColon :: mask :: _ ->
            let
                channel =
                    String.replace ":" "" channelColon
            in
            ( { state | akick = startLoad channel state.akick } |> setStatus channel "akick" ToneOk ("Added " ++ mask ++ ".")
            , [ Send (cs "AKICK" channel [ "LIST" ]) ]
            )

        "AKICK" :: "removed" :: "on" :: channelColon :: mask :: _ ->
            let
                channel =
                    String.replace ":" "" channelColon
            in
            ( { state | akick = Dict.update (key channel) (Maybe.map (\l -> { l | entries = List.filter (\e -> e.mask /= mask) l.entries })) state.akick }
                |> setStatus channel "akick" ToneOk ("Removed " ++ mask ++ ".")
            , []
            )

        "AKICK" :: channel :: mask :: _ ->
            let
                entry =
                    { mask = mask
                    , reason =
                        case String.indexes " :" text of
                            at :: _ ->
                                String.dropLeft (at + 2) text

                            [] ->
                                ""
                    }

                current =
                    Maybe.withDefault { loading = False, entries = [], buffer = [] } (Dict.get (key channel) state.akick)

                next =
                    if current.loading then
                        { current | buffer = current.buffer ++ [ entry ] }

                    else
                        { current | entries = List.filter (\e -> e.mask /= mask) current.entries ++ [ entry ] }
            in
            if validChannel channel then
                ( { state | akick = Dict.insert (key channel) next state.akick }, [] )

            else
                ( state, [] )

        "End" :: "of" :: "AKICK" :: "list" :: "for" :: channel :: _ ->
            ( { state | akick = endLoad channel state.akick }, [] )

        "SUCCESSOR:" :: channel :: "successor" :: "is" :: account :: _ ->
            ( { state | successor = Dict.insert (key channel) (Just account) state.successor }, [] )

        "SUCCESSOR:" :: channel :: "has" :: "no" :: "successor" :: _ ->
            ( { state | successor = Dict.insert (key channel) Nothing state.successor }, [] )

        "SUCCESSOR:" :: channel :: "successor" :: "set" :: "to" :: account :: _ ->
            ( { state | successor = Dict.insert (key channel) (Just account) state.successor }
                |> setStatus channel "successor" ToneOk (account ++ " will take over if the founder's account is dropped.")
            , []
            )

        [ "SUCCESSOR:", "cleared" ] ->
            case state.lastSuccessor of
                Just channel ->
                    ( { state | successor = Dict.insert (key channel) Nothing state.successor }
                        |> setStatus channel "successor" ToneOk "Successor cleared."
                    , []
                    )

                Nothing ->
                    ( state, [] )

        [ "LISTCHANS", channel, level ] ->
            let
                mine =
                    state.myRooms
            in
            ( { state | myRooms = { mine | loading = True, buffer = mine.buffer ++ [ { account = channel, level = level } ] } }, [] )

        "End" :: "of" :: "LISTCHANS" :: _ ->
            let
                mine =
                    state.myRooms
            in
            ( { state | myRooms = { loading = False, loaded = True, rooms = mine.buffer, buffer = [] } }, [] )

        "Mode" :: _ ->
            if String.contains "is locked by services (MLOCK" text then
                ( state, [ Toast ToneError "That rule is locked" (Just "The room's founder locked it. Only they can change it.") ] )

            else
                ( state, [] )

        "TEMPMODE:" :: "could" :: _ ->
            case state.lastModeTarget of
                Just channel ->
                    ( { state | timed = Dict.remove (key channel) state.timed }
                        |> setStatus channel "rules" ToneError "The server couldn't schedule that timed rule."
                    , []
                    )

                Nothing ->
                    ( state, [] )

        _ ->
            ( state, [] )


levelWord : String -> String
levelWord level =
    case String.toUpper level of
        "OP" ->
            "a host"

        "VOICE" ->
            "voiced"

        "FOUNDER" ->
            "a founder"

        "ADMIN" ->
            "an admin"

        other ->
            String.toLower other


{-| An INFO line resets desc/url (they follow on their own lines and are
absent when unset), answers a pending delete, and on the first answer
after opening the sheet asks for the successor.
-}
foldInfo : String -> RegInfo -> State -> ( State, List Effect )
foldInfo channel info state =
    let
        stored =
            { state | infoFor = Just channel }
                |> setReg channel (Registered info)
                |> seedInfoDrafts channel
    in
    case stored.pendingDelete of
        Just pending ->
            if key pending.channel == key channel && pending.stage == DeleteAwaitInfo then
                ( { stored | pendingDelete = Just { pending | stage = DeleteAwaitDrop } }
                , [ Send (cs "DROP" pending.channel []) ]
                )

            else
                ( stored, [] )

        Nothing ->
            if stored.autoLoad == Just (key channel) then
                ( { stored | autoLoad = Nothing }, [ Send (Wire.formatIrcLine "SUCCESSOR" [ channel, "SHOW" ]) ] )

            else
                ( stored, [] )


{-| Keep the open sheet's drafts in step with what INFO reported. -}
seedInfoDrafts : String -> State -> State
seedInfoDrafts channel state =
    if key state.drafts.channel /= key channel then
        state

    else
        case registrationOf channel state of
            Registered info ->
                setDrafts (\d -> { d | desc = info.desc, url = info.url, mlock = parseMlock info.mlock }) state

            _ ->
                state


foldDropped : String -> State -> ( State, List Effect )
foldDropped channel state =
    let
        dropped =
            setReg channel RegNone state
                |> setStatus channel "reg" ToneOk "Registration dropped."
    in
    case state.pendingDelete of
        Just pending ->
            if key pending.channel == key channel && pending.stage == DeleteAwaitDrop then
                ( { dropped | pendingDelete = Nothing }, clearOut pending )

            else
                ( dropped, [] )

        Nothing ->
            ( dropped, [ Toast ToneOk (channel ++ " is no longer registered") Nothing ] )


{-| `[#c] text` — the room's ONJOIN (we are in the room) or ONPART (we
just left it) message.
-}
foldPropMessage : FoldCtx -> String -> State -> ( State, List Effect )
foldPropMessage ctx text state =
    case String.indexes "] " text of
        at :: _ ->
            let
                channel =
                    String.slice 1 at text

                body =
                    String.trim (String.dropLeft (at + 2) text)
            in
            if not (validChannel channel) || String.isEmpty body then
                ( state, [] )

            else if ctx.inChannel channel then
                if Dict.get (key channel) state.welcomeSeen == Just body then
                    -- A rejoin after a reconnect repeats it: once a session.
                    ( state, [] )

                else
                    ( { state | welcomeSeen = Dict.insert (key channel) body state.welcomeSeen }
                    , [ SystemRow channel ("Welcome message: " ++ body) ]
                    )

            else
                ( state, [ Toast ToneInfo ("From " ++ channel) (Just body) ] )

        [] ->
            ( state, [] )
