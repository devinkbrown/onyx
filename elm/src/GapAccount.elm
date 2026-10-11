module GapAccount exposing
    ( Effect(..)
    , Erase(..)
    , GroupNick
    , ImportReview
    , LoadedLists
    , Msg(..)
    , QueuedAlert
    , Reply(..)
    , State
    , blank
    , classifyReply
    , coalescedTitle
    , decodeLoaded
    , encodeLists
    , groupLine
    , isValidMask
    , isValidNickToken
    , maxAlertTags
    , maxGroupNicks
    , maxQueuedAlerts
    , maxRecognizeMasks
    , protectionState
    , recognizeLine
    , rememberAlertTag
    , replyLooksRelevant
    , savedSearchLabel
    , upsertGroupNick
    )

{-| v3/gap-account — state, messages, effects and pure reply parsing for
the account-isolation / data / protection slice. Nothing here touches
`App`; `App` owns the integration (`updateGapAccount`,
`settleStepGapAccount`).

Server syntax is verified against the Onyx Server source
(`src/daemon/server.zig`):

  - `ACCOUNTSET <acct> <pw> secure|enforce on|off` → NOTICE
    `Account <acct> updated (<field>)`; a wrong password is `464`;
    bad values are `FAIL ACCOUNTSET INVALID_VALUE|INVALID_FIELD`.
    `ACCOUNTINFO` reports only `flags`: bit 4 (16) is secure, bit 3
    (8) is "enforce off" (enforce is on by default).
  - `RECOVER <nick>` / `RELEASE <nick>` take NO password: the caller
    must already be identified to the account that owns the nick.
    Replies are NOTICEs `RECOVER: …` / `RELEASE: …` or
    `FAIL RECOVER|RELEASE NICK_NOT_REGISTERED|ACCESS_DENIED`.
  - `RECOGNIZE ADD|DEL|LIST [mask]` → NOTICEs `Recognize: <mask>` (one
    per row, no end marker), `Recognition list for <acct> is empty`,
    `Recognize <mask>: <outcome>`; errors are `481`.
  - `GROUP ADD|DEL|LIST|PRIMARY [nick]` → NOTICEs `GROUP <nick>[
    (primary)]` then `GROUP: end of list`; `GROUP nick added|removed`,
    `GROUP primary set`, `GROUP: <error>`; `FAIL GROUP ACCOUNT_REQUIRED`.

-}

import AccountScope
import Bitwise
import Dict exposing (Dict)
import Json.Decode as Decode
import Json.Encode as Encode
import Wire


{-| Local-history erase progress (turning history off, or Clear). -}
type Erase
    = EraseIdle
    | Erasing
    | EraseVerified
    | EraseFailed


{-| A picked portable-vault file waiting for the user's review. The
JSON is kept as text and re-validated on Import, so nothing reaches the
vault until the user confirms. -}
type alias ImportReview =
    { json : String
    , conversations : Int
    , messages : Int
    , exportedAt : String
    }


{-| A desktop alert held back by the per-conversation throttle. It is
re-decided against the CURRENT policy when the window opens, then
shown once as "N new alerts in <conversation>". -}
type alias QueuedAlert =
    { title : String
    , label : String
    , body : String
    , private : Bool
    , count : Int
    , sender : String
    , isDm : Bool
    , queuedAt : Float
    }


type alias GroupNick =
    { nick : String
    , primary : Bool
    }


type alias State =
    { -- device-memory scope
      scope : Maybe String
    , scopeGuest : Bool
    , socketAccount : Maybe String
    , listsLoadedFor : Maybe String
    , pendingOps : AccountScope.PendingOps
    , sessionOps : AccountScope.PendingOps

    -- local history
    , erase : Erase
    , clearConfirm : Bool
    , historyStatus : Maybe String
    , clearWatermark : Dict String Int

    -- saved searches
    , searchClearConfirm : Bool
    , searchStatus : Maybe String

    -- portable vault transfer
    , exportConfirm : Bool
    , importReview : Maybe ImportReview
    , importStatus : Maybe String

    -- account protection
    , protectPassword : String
    , protectPending : Maybe { field : String, on : Bool }
    , protectError : Maybe String
    , protectNotice : Maybe String
    , recoverNick : String
    , recoverPending : Maybe { verb : String, nick : String }
    , recoverStatus : Maybe { ok : Bool, text : String }
    , recognize : List String
    , recognizeLoading : Bool
    , recognizeDraft : String
    , recognizeStatus : Maybe { ok : Bool, text : String }
    , groupNicks : List GroupNick
    , groupLoading : Bool
    , groupDraft : String
    , groupStatus : Maybe { ok : Bool, text : String }

    -- alerts, title, badge
    , alertTags : Dict String String
    , alertTagOrder : List String
    , alertQueue : Dict String QueuedAlert
    , badge : Int
    }


blank : State
blank =
    { scope = Nothing
    , scopeGuest = False
    , socketAccount = Nothing
    , listsLoadedFor = Nothing
    , pendingOps = AccountScope.emptyOps
    , sessionOps = AccountScope.emptyOps
    , erase = EraseIdle
    , clearConfirm = False
    , historyStatus = Nothing
    , clearWatermark = Dict.empty
    , searchClearConfirm = False
    , searchStatus = Nothing
    , exportConfirm = False
    , importReview = Nothing
    , importStatus = Nothing
    , protectPassword = ""
    , protectPending = Nothing
    , protectError = Nothing
    , protectNotice = Nothing
    , recoverNick = ""
    , recoverPending = Nothing
    , recoverStatus = Nothing
    , recognize = []
    , recognizeLoading = False
    , recognizeDraft = ""
    , recognizeStatus = Nothing
    , groupNicks = []
    , groupLoading = False
    , groupDraft = ""
    , groupStatus = Nothing
    , alertTags = Dict.empty
    , alertTagOrder = []
    , alertQueue = Dict.empty
    , badge = 0
    }


type Msg
    = -- local history (Preferences → History & data)
      LocalHistorySet Bool
    | HistoryClearAsk
    | HistoryClearCancel
    | HistoryClearConfirm
    | VaultCleared { ok : Bool }
      -- saved searches
    | SearchClearAsk
    | SearchClearCancel
    | SearchClearConfirm
    | SearchExport
    | SearchImport
      -- portable vault (Preferences → Import & export)
    | ExportAsk
    | ExportCancel
    | ExportConfirm
    | ImportConfirm
    | ImportCancel
    | ImportRefused { reason : String }
      -- account protection (Account → Protection)
    | ProtectPassword String
    | ProtectToggle String Bool
    | RecoverNickInput String
    | RecoverSubmit
    | ReleaseSubmit
    | RecognizeDraft String
    | RecognizeAdd
    | RecognizeRemove String
    | RecognizeRefresh
    | GroupDraft String
    | GroupAdd
    | GroupRemove String
    | GroupPrimary String
    | GroupRefresh
      -- ports
    | ScopedListsLoaded Decode.Value
    | NotifyClicked { tag : String }


type Effect
    = ScopedListsRequest { scope : String, solidOwners : List String }
    | ScopedListsSave { scope : String, lists : Encode.Value }
    | VaultClear
    | AppBadge Int



-- BOUNDS


maxAlertTags : Int
maxAlertTags =
    64


maxQueuedAlerts : Int
maxQueuedAlerts =
    64


maxRecognizeMasks : Int
maxRecognizeMasks =
    64


maxGroupNicks : Int
maxGroupNicks =
    64


{-| Remember which scope raised a desktop alert so a click can never
navigate a different identity's conversation (oldest tag dropped past
the cap). -}
rememberAlertTag : String -> String -> State -> State
rememberAlertTag tag owner state =
    let
        order =
            List.filter (\t -> t /= tag) state.alertTagOrder ++ [ tag ]

        overflow =
            List.length order - maxAlertTags

        ( dropped, kept ) =
            if overflow > 0 then
                ( List.take overflow order, List.drop overflow order )

            else
                ( [], order )
    in
    { state
        | alertTags = List.foldl Dict.remove (Dict.insert tag owner state.alertTags) dropped
        , alertTagOrder = kept
    }


{-| `1 saved search`, `3 saved searches` (the shared `countLabel` would
say "searchs"). -}
savedSearchLabel : Int -> String
savedSearchLabel n =
    String.fromInt n
        ++ (if n == 1 then
                " saved search"

            else
                " saved searches"
           )


{-| Title for a coalesced alert. -}
coalescedTitle : QueuedAlert -> String
coalescedTitle alert =
    if alert.count > 1 then
        String.fromInt alert.count ++ " new alerts in " ++ alert.label

    else
        alert.title



-- SCOPED LISTS (ports payloads)


type alias LoadedLists =
    { scope : String
    , ignored : List String
    , muted : List String
    , highlights : List String
    , notify : List { channel : String, level : String }
    }


lenientStrings : Decode.Decoder (List String)
lenientStrings =
    Decode.oneOf
        [ Decode.list (Decode.oneOf [ Decode.map Just Decode.string, Decode.succeed Nothing ])
            |> Decode.map (List.filterMap identity)
        , Decode.succeed []
        ]


lenientNotify : Decode.Decoder (List { channel : String, level : String })
lenientNotify =
    Decode.oneOf
        [ Decode.list
            (Decode.oneOf
                [ Decode.map2 (\c l -> Just { channel = c, level = l })
                    (Decode.field "channel" Decode.string)
                    (Decode.field "level" Decode.string)
                , Decode.succeed Nothing
                ]
            )
            |> Decode.map (List.filterMap identity)
        , Decode.succeed []
        ]


{-| Decode a `gapScopedListsLoaded` answer. Anything malformed in a list
reads as absent entries (the App re-normalizes every name fail-closed);
an answer without a scope is rejected. -}
decodeLoaded : Decode.Value -> Maybe LoadedLists
decodeLoaded value =
    Decode.decodeValue
        (Decode.map5 LoadedLists
            (Decode.field "scope" Decode.string)
            (Decode.oneOf [ Decode.field "ignored" lenientStrings, Decode.succeed [] ])
            (Decode.oneOf [ Decode.field "muted" lenientStrings, Decode.succeed [] ])
            (Decode.oneOf [ Decode.field "highlights" lenientStrings, Decode.succeed [] ])
            (Decode.oneOf [ Decode.field "notify" lenientNotify, Decode.succeed [] ])
        )
        value
        |> Result.toMaybe
        |> Maybe.andThen
            (\loaded ->
                if String.isEmpty loaded.scope then
                    Nothing

                else
                    Just loaded
            )


{-| Encode only the lists that changed (`Nothing` = untouched). -}
encodeLists :
    { ignored : Maybe (List String)
    , muted : Maybe (List String)
    , highlights : Maybe (List String)
    , notify : Maybe (List ( String, String ))
    }
    -> Encode.Value
encodeLists lists =
    Encode.object
        (List.filterMap identity
            [ Maybe.map (\v -> ( "ignored", Encode.list Encode.string v )) lists.ignored
            , Maybe.map (\v -> ( "muted", Encode.list Encode.string v )) lists.muted
            , Maybe.map (\v -> ( "highlights", Encode.list Encode.string v )) lists.highlights
            , Maybe.map
                (\v ->
                    ( "notify"
                    , Encode.list
                        (\( ch, level ) -> Encode.object [ ( "channel", Encode.string ch ), ( "level", Encode.string level ) ])
                        v
                    )
                )
                lists.notify
            ]
        )



-- ACCOUNT PROTECTION


{-| Secure / enforce as the server reports them: explicit fields win,
else the `flags` bits (secure = 16, enforce-off = 8). Unknown stays
`Nothing` so the switches render as "not known yet" rather than lie. -}
protectionState : { a | flags : Maybe Int, secure : Maybe Bool, enforce : Maybe Bool } -> { secure : Maybe Bool, enforce : Maybe Bool }
protectionState info =
    { secure =
        case info.secure of
            Just b ->
                Just b

            Nothing ->
                Maybe.map (\f -> Bitwise.and f 16 /= 0) info.flags
    , enforce =
        case info.enforce of
            Just b ->
                Just b

            Nothing ->
                Maybe.map (\f -> Bitwise.and f 8 == 0) info.flags
    }


isUnsafe : Char -> Bool
isUnsafe c =
    let
        code =
            Char.toCode c
    in
    c == ' ' || code < 0x20 || code == 0x7F


{-| A nick as a single wire token: bounded, no whitespace or controls,
never a channel or a trailing marker. -}
isValidNickToken : String -> Bool
isValidNickToken raw =
    let
        nick =
            String.trim raw
    in
    not (String.isEmpty nick)
        && String.length nick <= 64
        && not (String.any isUnsafe nick)
        && not (String.startsWith ":" nick)
        && not (String.startsWith "#" nick)
        && not (String.startsWith "&" nick)
        && not (String.contains "," nick)


{-| A recognition mask (`nick!user@host` style): one bounded token
with no whitespace/controls. The server is the authority on the mask
grammar (`invalid_mask`); this only keeps the wire well-formed. -}
isValidMask : String -> Bool
isValidMask raw =
    let
        mask =
            String.trim raw
    in
    not (String.isEmpty mask)
        && String.length mask <= 255
        && not (String.any isUnsafe mask)
        && not (String.startsWith ":" mask)


recognizeLine : String -> Maybe String -> Maybe String
recognizeLine sub mask =
    case mask of
        Nothing ->
            if sub == "LIST" then
                Just (Wire.formatIrcLine "RECOGNIZE" [ "LIST" ])

            else
                Nothing

        Just m ->
            if (sub == "ADD" || sub == "DEL") && isValidMask m then
                Just (Wire.formatIrcLine "RECOGNIZE" [ sub, String.trim m ])

            else
                Nothing


groupLine : String -> Maybe String -> Maybe String
groupLine sub nick =
    case nick of
        Nothing ->
            if sub == "LIST" then
                Just (Wire.formatIrcLine "GROUP" [ "LIST" ])

            else
                Nothing

        Just n ->
            if List.member sub [ "ADD", "DEL", "PRIMARY" ] && isValidNickToken n then
                Just (Wire.formatIrcLine "GROUP" [ sub, String.trim n ])

            else
                Nothing


upsertGroupNick : GroupNick -> List GroupNick -> List GroupNick
upsertGroupNick row rows =
    if List.any (\r -> String.toLower r.nick == String.toLower row.nick) rows then
        List.map
            (\r ->
                if String.toLower r.nick == String.toLower row.nick then
                    row

                else
                    r
            )
            rows

    else if List.length rows >= maxGroupNicks then
        rows

    else
        rows ++ [ row ]



-- REPLIES


{-| Server replies this slice folds (everything else is ignored). -}
type Reply
    = ProtectSaved String
    | ProtectWrongPassword
    | ProtectFailed String
    | RecoverNotice { verb : String, nick : Maybe String, ok : Bool, text : String }
    | RecoverFailed { verb : String, code : String, text : String }
    | RecognizeRow String
    | RecognizeEmpty
    | RecognizeResult { mask : String, ok : Bool, text : String }
    | RecognizeDenied String
    | GroupRow GroupNick
    | GroupEnd
    | GroupResult { ok : Bool, text : String }
    | GroupFailed String


{-| Cheap pre-filter on the raw line so the settle step only parses
lines that can matter. -}
replyLooksRelevant : String -> Bool
replyLooksRelevant raw =
    List.any (\needle -> String.contains needle raw)
        [ " updated (", " 464 ", "ACCOUNTSET", "RECOVER", "RELEASE", "Recogni", "RECOGNIZE", "GROUP" ]


fromServer : Wire.IrcMessage -> Bool
fromServer message =
    message.nick == Nothing


lastParam : List String -> String
lastParam params =
    Maybe.withDefault "" (List.head (List.reverse params))


{-| Classify one server line. Only server-origin lines count — a user
NOTICE that imitates a service reply can never flip protection state. -}
classifyReply : Wire.IrcMessage -> Maybe Reply
classifyReply message =
    if not (fromServer message) then
        Nothing

    else
        case String.toUpper message.command of
            "NOTICE" ->
                case message.params of
                    _ :: text :: _ ->
                        classifyNotice (String.trim text)

                    _ ->
                        Nothing

            "464" ->
                Just ProtectWrongPassword

            -- 481 not identified, 421 services unavailable, 461 usage
            "481" ->
                recognizeRefusal message.params

            "421" ->
                recognizeRefusal message.params

            "461" ->
                recognizeRefusal message.params

            "FAIL" ->
                case message.params of
                    command :: code :: rest ->
                        case String.toUpper command of
                            "ACCOUNTSET" ->
                                Just (ProtectFailed (failCopy code (lastParam rest)))

                            "RECOVER" ->
                                Just (RecoverFailed { verb = "RECOVER", code = code, text = failCopy code (lastParam rest) })

                            "RELEASE" ->
                                Just (RecoverFailed { verb = "RELEASE", code = code, text = failCopy code (lastParam rest) })

                            "GROUP" ->
                                Just (GroupFailed (failCopy code (lastParam rest)))

                            _ ->
                                Nothing

                    _ ->
                        Nothing

            _ ->
                Nothing


recognizeRefusal : List String -> Maybe Reply
recognizeRefusal params =
    case params of
        _ :: "RECOGNIZE" :: rest ->
            Just (RecognizeDenied (lastParam rest))

        _ ->
            Nothing


failCopy : String -> String -> String
failCopy code description =
    case code of
        "NICK_NOT_REGISTERED" ->
            "That name isn't registered."

        "ACCESS_DENIED" ->
            "Sign in to the account that owns that name first."

        "ACCOUNT_REQUIRED" ->
            "Sign in to manage this."

        "TEMPORARILY_UNAVAILABLE" ->
            "Accounts are unavailable right now. Try again later."

        "INVALID_VALUE" ->
            "The server rejected that setting."

        "INVALID_FIELD" ->
            "This server doesn't support that setting."

        _ ->
            if String.isEmpty (String.trim description) then
                "The server refused that request."

            else
                description


classifyNotice : String -> Maybe Reply
classifyNotice text =
    if String.startsWith "Account " text && (String.endsWith " updated (secure)" text || String.endsWith " updated (enforce)" text) then
        Just
            (ProtectSaved
                (if String.endsWith "(secure)" text then
                    "secure"

                 else
                    "enforce"
                )
            )

    else if String.startsWith "RECOVER: " text then
        Just (recoverNotice "RECOVER" (String.dropLeft 9 text))

    else if String.startsWith "RELEASE: " text then
        Just (recoverNotice "RELEASE" (String.dropLeft 9 text))

    else if String.startsWith "Recognize: " text then
        Just (RecognizeRow (String.trim (String.dropLeft 11 text)))

    else if String.startsWith "Recognition list for " text && String.endsWith " is empty" text then
        Just RecognizeEmpty

    else if String.startsWith "Recognize " text then
        case splitOnce ": " (String.dropLeft 10 text) of
            Just ( mask, outcome ) ->
                Just
                    (RecognizeResult
                        { mask = mask
                        , ok = String.startsWith "added" outcome || String.startsWith "removed" outcome
                        , text = outcome
                        }
                    )

            Nothing ->
                Nothing

    else if text == "GROUP: end of list" then
        Just GroupEnd

    else if text == "GROUP nick added" then
        Just (GroupResult { ok = True, text = "Name added to your group." })

    else if text == "GROUP nick removed" then
        Just (GroupResult { ok = True, text = "Name removed from your group." })

    else if text == "GROUP primary set" then
        Just (GroupResult { ok = True, text = "Primary name set." })

    else if String.startsWith "GROUP: " text then
        Just (GroupResult { ok = False, text = groupErrorCopy (String.dropLeft 7 text) })

    else if String.startsWith "GROUP " text then
        let
            rest =
                String.dropLeft 6 text
        in
        case String.words rest of
            [ nick ] ->
                Just (GroupRow { nick = nick, primary = False })

            [ nick, "(primary)" ] ->
                Just (GroupRow { nick = nick, primary = True })

            _ ->
                Nothing

    else
        Nothing


groupErrorCopy : String -> String
groupErrorCopy raw =
    if String.startsWith "could not add" raw then
        "Couldn't add that name — it may be invalid, already grouped, or over the limit."

    else if String.startsWith "no such grouped nick" raw then
        "That name isn't in your group."

    else if String.startsWith "nick must be in your group first" raw then
        "Add the name to your group before making it primary."

    else
        raw


recoverNotice : String -> String -> Reply
recoverNotice verb body =
    if String.startsWith "forced the holder off " body then
        let
            nick =
                String.dropLeft 22 body
                    |> String.split ";"
                    |> List.head
                    |> Maybe.map String.trim
        in
        RecoverNotice { verb = verb, nick = nick, ok = True, text = "Done — the name is free for you now." }

    else if String.startsWith "dropped the server hold on " body then
        RecoverNotice { verb = verb, nick = Just (String.trim (String.dropLeft 27 body)), ok = True, text = "Released — the server is no longer holding that name." }

    else if String.startsWith "nobody else is holding" body then
        RecoverNotice { verb = verb, nick = Nothing, ok = True, text = "Nobody else is using that name." }

    else if String.startsWith "there is no server hold" body then
        RecoverNotice { verb = verb, nick = Nothing, ok = True, text = "The server isn't holding that name." }

    else
        RecoverNotice { verb = verb, nick = Nothing, ok = False, text = body }


splitOnce : String -> String -> Maybe ( String, String )
splitOnce needle haystack =
    case String.indexes needle haystack of
        i :: _ ->
            Just ( String.left i haystack, String.dropLeft (i + String.length needle) haystack )

        [] ->
            Nothing
