module ViewTest exposing (suite)

{-| Smoke tests for the revamped views: empty states, thread/roster
rendering, grouped roster sections, connection-aware composer, and the
rail select event. Rendering only — all fold semantics stay in
`AppTest`.
-}

import App exposing (..)
import Dict
import Set
import Download
import Expect
import Stats
import Html
import Html.Attributes as Attr
import Isupport
import Json.Encode as Encode
import Media
import Route
import Test exposing (Test, describe, test)
import Status
import Test.Html.Event as Event
import Time
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Url
import View
import View.About exposing (accessibilityTopics)
import View.PublicFrame exposing (normalisePath)
import View.Onyxos exposing (onyxosStages, stageById)
import View.PublicInfo
import View.Trust exposing (houseRules, trustPageForPath)


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


channelModel : Model
channelModel =
    { blank | caps = [ "chathistory" ] }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":alice!u@h JOIN #c")
        |> (\m -> feed m ":s 353 me = #c :@alice +bob carol")
        |> (\m -> feed m ":alice!u@h PRIVMSG #c :hello world")
        |> (\m -> Tuple.first (update (ChannelSelect "#c") m))


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


banMeta : BanListStatus -> BanListMeta
banMeta status =
    { status = status, updatedAt = Nothing, error = Nothing, generation = 1, epoch = 0 }


banChannelWith : Set.Set Char -> Channel
banChannelWith modes =
    { name = "#c"
    , topic = ""
    , members = Dict.singleton "me" { nick = "me", modes = modes, away = False }
    , modes = ""
    , messages = []
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


banOpModel : Model
banOpModel =
    { blank
        | connection = Live
        , activeChannel = Just "#c"
        , channels = Dict.singleton "#c" (banChannelWith (Set.singleton 'o'))
        , banList =
            Dict.singleton "#c"
                { order = 0
                , entries = [ { mask = "*!*@bad.example", setBy = Just "alice", setAt = Nothing } ]
                }
        , banListMeta = Dict.singleton "#c" (banMeta BanReady)
    }


banVoiceModel : Model
banVoiceModel =
    { banOpModel | channels = Dict.singleton "#c" (banChannelWith (Set.singleton 'v')) }


stewardChannel : Channel
stewardChannel =
    { name = "#harbor"
    , topic = ""
    , members =
        Dict.fromList
            [ ( "alice", { nick = "alice", modes = Set.fromList [ 'Q', 'q' ], away = False } )
            , ( "bob", { nick = "bob", modes = Set.singleton 'o', away = False } )
            , ( "drew", { nick = "drew", modes = Set.empty, away = False } )
            ]
    , modes = ""
    , messages = []
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


stewardModel : Model
stewardModel =
    { blank
        | connection = Live
        , ourNick = "alice"
        , activeChannel = Just "#harbor"
        , channels = Dict.singleton "#harbor" stewardChannel
        , stewardRoom = Just "#harbor"
    }


inboxModel : Model
inboxModel =
    { blank
        | showNotificationCenter = True
        , notifications =
            [ { id = "notif-0", kind = NotifMention, text = "hey you", from = Just "alice", channel = Just "#c", topic = Nothing, atMs = 1000 }
            , { id = "notif-1", kind = NotifError, text = "Nickname in use: taken", from = Nothing, channel = Nothing, topic = Nothing, atMs = 2000 }
            ]
        , readNotificationIds = Set.singleton "notif-1"
    }


bigModel : Model
bigModel =
    let
        messages =
            List.map
                (\i ->
                    { id = i
                    , from = "u"
                    , body = "row-" ++ String.fromInt i
                    , whisper = False
                    , audience = Nothing
                    , highlight = False
                    , outboxId = Nothing
                    , pending = False
                    , plaintext = Nothing
                    , at = i
                    , msgid = Nothing
                    , reactions = []
                    , edited = False
                    , deleted = False
                    , redacted = False
                    , topic = ""
                    , msgType = "msg"
                    }
                )
                (List.reverse (List.range 1 150))

        channel =
            { name = "#c"
            , topic = ""
            , members = Dict.empty
            , modes = ""
            , messages = messages
            , lastSeen = Nothing
            , unread = 0
            , highlights = 0
            , createdAt = Nothing
            }
    in
    { blank | activeChannel = Just "#c", channels = Dict.fromList [ ( "#c", channel ) ] }


suite : Test
suite =
    describe "View"
        [ test "blank model renders the welcome empty state" <|
            \_ ->
                query blank
                    |> Query.has [ Selector.text "Welcome to Onyx" ]
        , test "offline model keeps the composer enabled with queue guidance" <|
            \_ ->
                let
                    q =
                        query { blank | connection = Offline, activeChannel = Just "#c" }
                in
                Expect.all
                    [ \_ ->
                        Query.find [ Selector.tag "input" ] q
                            |> Query.has
                                [ Selector.attribute (Attr.placeholder "Offline — sends queue on this device")
                                , Selector.disabled False
                                ]
                    , \_ ->
                        Query.find [ Selector.class "onyx-composer", Selector.tag "button", Selector.attribute (Attr.type_ "submit") ] q
                            |> Query.has [ Selector.disabled False ]
                    ]
                    ()
        , test "composer error renders as an alert" <|
            \_ ->
                query { blank | activeChannel = Just "#c", composerError = Just "Unblock them on this device to send a message." }
                    |> Query.find [ Selector.class "onyx-composer-error" ]
                    |> Query.has [ Selector.text "Unblock them on this device to send a message." ]
        , test "composer without a channel stays disabled" <|
            \_ ->
                let
                    q =
                        query blank
                in
                Query.find [ Selector.tag "input" ] q
                    |> Query.has
                        [ Selector.attribute (Attr.placeholder "Select a channel")
                        , Selector.disabled True
                        ]
        , test "thread renders folded message bodies" <|
            \_ ->
                query channelModel
                    |> Query.has [ Selector.text "hello world" ]
        , test "link preview card renders with consent-gated thumbnail" <|
            \_ ->
                let
                    withLink =
                        feed channelModel ":alice!u@h PRIVMSG #c :read https://example.test/story today"

                    card =
                        { url = "https://example.test/story"
                        , title = "Story"
                        , description = "A description"
                        , image = "https://cdn.example.test/i.png"
                        , site = "Example"
                        }

                    cached =
                        { withLink
                            | origin = "https://app.example.test"
                            , linkPreviews =
                                Dict.fromList [ ( "https://example.test/story", Just card ) ]
                        }

                    allowed =
                        Tuple.first (update (PreviewImageAllow "https://cdn.example.test/i.png") cached)
                in
                Expect.all
                    [ \_ ->
                        query cached
                            |> Query.find [ Selector.class "shell-msg-preview" ]
                            |> Query.has [ Selector.text "Story", Selector.text "Example" ]
                    , \_ ->
                        query cached
                            |> Query.has [ Selector.text "Load image" ]
                    , \_ ->
                        query allowed
                            |> Query.find [ Selector.class "shell-msg-preview-thumb" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "src" "https://cdn.example.test/i.png") ]
                    , \_ ->
                        query { cached | linkPreviews = Dict.fromList [ ( "https://example.test/story", Nothing ) ] }
                            |> Query.hasNot [ Selector.class "shell-msg-preview" ]
                    ]
                    ()
        , test "pins drawer lists newest-first with jump and op unpin" <|
            \_ ->
                let
                    withPins =
                        feed channelModel ":s 818 me #c PINS :m1,m2"

                    withMsg =
                        feed withPins "@msgid=m2 :alice!u@h PRIVMSG #c :hello"

                    open =
                        { withMsg | showPinnedMessages = True, isOper = True }
                in
                Expect.all
                    [ \_ ->
                        query open
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "pinned-messages") ]
                            |> Query.has [ Selector.text "hello" ]
                    , \_ ->
                        query open
                            |> Query.has [ Selector.text "Pinned message — load it from history to jump there." ]
                    , \_ ->
                        query open
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Unpin message m1") ]
                    , \_ ->
                        query { open | isOper = False }
                            |> Query.hasNot [ Selector.text "Unpin message" ]
                    , \_ ->
                        query open
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ribbon-pins") ]
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "2 pinned messages") ]
                    ]
                    ()
        , test "pins drawer empty and feedback states" <|
            \_ ->
                let
                    open =
                        { channelModel | showPinnedMessages = True }

                    failed =
                        { open | pinsLoadFeedback = "Pinned message could not be loaded from history. Try again." }
                in
                Expect.all
                    [ \_ ->
                        query open
                            |> Query.has [ Selector.text "Ops can pin important messages here." ]
                    , \_ ->
                        query failed
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "pins-load-feedback") ]
                            |> Query.has [ Selector.text "Pinned message could not be loaded from history. Try again." ]
                    , \_ ->
                        query channelModel
                            |> Query.hasNot [ Selector.attribute (Attr.attribute "data-testid" "pinned-messages") ]
                    ]
                    ()
        , test "same-origin preview thumbnails load without consent" <|
            \_ ->
                let
                    withLink =
                        feed channelModel ":alice!u@h PRIVMSG #c :read https://example.test/story today"

                    card =
                        { url = "https://example.test/story"
                        , title = "Story"
                        , description = ""
                        , image = "https://app.example.test/i.png"
                        , site = ""
                        }

                    cached =
                        { withLink
                            | origin = "https://app.example.test"
                            , linkPreviews =
                                Dict.fromList [ ( "https://example.test/story", Just card ) ]
                        }
                in
                Expect.all
                    [ \_ ->
                        query cached
                            |> Query.find [ Selector.class "shell-msg-preview-thumb" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "src" "https://app.example.test/i.png") ]
                    , \_ ->
                        query cached
                            |> Query.hasNot [ Selector.text "Load image" ]
                    ]
                    ()
        , test "composer attach button and staged rows render" <|
            \_ ->
                let
                    staged =
                        { channelModel
                            | attachments =
                                [ { id = 0, key = "att-0", position = 0, name = "a.png", size = 10, mime = "image/png", status = StagedUploading, progress = Just 42 }
                                ]
                        }
                in
                Expect.all
                    [ \_ ->
                        query staged
                            |> Query.find [ Selector.class "onyx-attach-open" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Attach files") ]
                    , \_ ->
                        query staged
                            |> Query.has [ Selector.text "Uploading 42%" ]
                    , \_ ->
                        query staged
                            |> Query.find [ Selector.class "shell-attachment-progress" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "value" "42") ]
                    , \_ ->
                        query
                            { channelModel
                                | attachments =
                                    [ { id = 0, key = "att-0", position = 0, name = "a.png", size = 10, mime = "image/png", status = StagedUploading, progress = Nothing }
                                    ]
                            }
                            |> Query.has [ Selector.text "Uploading…" ]
                    ]
                    ()
        , test "topic picker offers registry conversations" <|
            \_ ->
                let
                    topical =
                        { channelModel | topicHistory = Dict.fromList [ ( "#c", [ "Sprint" ] ) ] }

                    ( selected, _ ) =
                        update (ChannelTopicSelect { channel = "#c", topic = Just "Sprint" }) topical
                in
                Expect.all
                    [ \_ ->
                        query topical
                            |> Query.has [ Selector.text "Sprint" ]
                    , \_ ->
                        query selected
                            |> Query.has [ Selector.text "Conversation: Sprint " ]
                    ]
                    ()
        , test "thread renders attachment cards with links" <|
            \_ ->
                let
                    withFile =
                        channelModel
                            |> (\m -> feed m ":alice!u@h PRIVMSG #c :see this\n[file: a.png] 2.0 KB https://cdn.example.test/a.png")
                in
                query withFile
                    |> Query.find [ Selector.class "onyx-attachment-link" ]
                    |> Query.has [ Selector.text "a.png (2.0 KB)" ]
        , test "thread marks queued placeholders pending" <|
            \_ ->
                let
                    ( queued, _ ) =
                        update (OutboxQueued { id = "ob-9", target = "#c", text = "later", queuedAt = 5 }) channelModel

                    q =
                        query queued
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-pending" ] q
                    , \_ -> Query.has [ Selector.text "· queued" ] q
                    ]
                    ()
        , test "thread shows the UTC clock for stamped rows" <|
            \_ ->
                let
                    stamped =
                        blank
                            |> (\m -> feed m ":me!u@h JOIN #c")
                            |> (\m -> feed m ":alice!u@h JOIN #c")
                            |> (\m -> feed m "@time=2026-10-04T12:34:00Z :alice!u@h PRIVMSG #c :stamped")
                            |> (\m -> Tuple.first (update (ChannelSelect "#c") m))

                    q =
                        query stamped
                in
                Expect.all
                    [ \_ ->
                        Query.find [ Selector.tag "time" ] q
                            |> Query.has
                                [ Selector.text "12:34"
                                , Selector.attribute (Attr.datetime "2026-10-04T12:34:00.000Z")
                                ]
                    ]
                    ()
        , test "thread hides the clock for unstamped rows" <|
            \_ ->
                query channelModel
                    |> Query.hasNot [ Selector.tag "time" ]
        , test "thread renders boost chips with you state and toggle" <|
            \_ ->
                let
                    reacted =
                        { blank | ourNick = "me" }
                            |> (\m -> feed m ":me!u@h JOIN #c")
                            |> (\m -> feed m ":alice!u@h JOIN #c")
                            |> (\m -> feed m "@msgid=m1 :alice!u@h PRIVMSG #c :hello world")
                            |> (\m -> feed m "@+draft/react=👍;+draft/reply=m1 :bob!u@h TAGMSG #c")
                            |> (\m -> feed m "@+draft/react=👍;+draft/reply=m1 :me!u@h TAGMSG #c")
                            |> (\m -> Tuple.first (update (ChannelSelect "#c") m))

                    q =
                        query reacted
                in
                Expect.all
                    [ \_ ->
                        Query.find [ Selector.class "boost-bar" ] q
                            |> Query.has [ Selector.text "👍", Selector.text "2" ]
                    , \_ ->
                        Query.find [ Selector.class "boost-pill", Selector.class "you" ] q
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-pressed" "true") ]
                    , \_ ->
                        Query.find [ Selector.class "boost-pill" ] q
                            |> Event.simulate Event.click
                            |> Event.expect (ReactionSend "#c" "m1" "👍")
                    ]
                    ()
        , test "thread marks edited and withdrawn rows" <|
            \_ ->
                let
                    edited =
                        { blank | ourNick = "me" }
                            |> (\m -> feed m ":me!u@h JOIN #c")
                            |> (\m -> feed m ":alice!u@h JOIN #c")
                            |> (\m -> feed m "@msgid=m1 :alice!u@h PRIVMSG #c :hello world")
                            |> (\m -> feed m ":alice!u@h EDIT #c m1 :hello edited")
                            |> (\m -> Tuple.first (update (ChannelSelect "#c") m))

                    withdrawn =
                        feed edited ":alice!u@h REDACT #c m1"
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-edited", Selector.text "· edited" ] (query edited)
                    , \_ -> Query.has [ Selector.class "onyx-withdrawn" ] (query withdrawn)
                    , \_ -> Query.has [ Selector.text "[message deleted]" ] (query withdrawn)
                    ]
                    ()
        , test "thread flags mentions and shows the typing line" <|
            \_ ->
                let
                    mentioned =
                        { blank | ourNick = "me" }
                            |> (\m -> feed m ":me!u@h JOIN #c")
                            |> (\m -> feed m ":alice!u@h JOIN #c")
                            |> (\m -> feed m ":alice!u@h PRIVMSG #c :hi me")
                            |> (\m -> feed m "@+typing=active :bob!u@h TAGMSG #c")
                            |> (\m -> Tuple.first (update (ChannelSelect "#c") m))

                    q =
                        query mentioned
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-mention" ] q
                    , \_ -> Query.has [ Selector.class "onyx-typing", Selector.text "bob is typing…" ] q
                    ]
                    ()
        , test "thread windows long buffers to the trailing slice" <|
            \_ ->
                let
                    q =
                        query bigModel

                    rows =
                        Query.findAll [ Selector.class "onyx-message" ] q
                in
                Expect.all
                    [ \_ -> Query.count (Expect.equal 120) rows
                    , \_ ->
                        Query.find [ Selector.class "onyx-earlier-count" ] q
                            |> Query.has [ Selector.text "30" ]
                    , \_ -> Query.has [ Selector.class "onyx-earlier-button" ] q
                    , \_ -> Query.hasNot [ Selector.class "onyx-latest-button" ] q
                    ]
                    ()
        , test "thread pages back and jumps to latest" <|
            \_ ->
                let
                    paged =
                        { bigModel | threadPageStart = Just 10 }
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-latest-button" ] (query paged)
                    , \_ -> Query.has [ Selector.class "onyx-earlier-button" ] (query paged)
                    , \_ -> Query.hasNot [ Selector.class "onyx-earlier-button" ] (query channelModel)
                    , \_ -> Query.hasNot [ Selector.class "onyx-latest-button" ] (query channelModel)
                    ]
                    ()
        , test "thread renders the unread divider above its boundary row" <|
            \_ ->
                let
                    -- The boundary message arrived while #c was in
                    -- the background, so opening it captured the
                    -- divider; a message read live captures none.
                    caughtUp =
                        blank
                            |> (\m -> feed m ":alice!u@h JOIN #c")
                            |> (\m -> Tuple.first (update (ChannelSelect "#c") m))
                            |> (\m -> feed m ":alice!u@h PRIVMSG #c :hello")
                in
                Expect.all
                    [ \_ ->
                        query channelModel
                            |> Query.has
                                [ Selector.class "onyx-unread-divider"
                                , Selector.attribute (Attr.attribute "aria-label" "New messages")
                                , Selector.text "New messages"
                                ]
                    , \_ ->
                        query caughtUp
                            |> Query.hasNot [ Selector.class "onyx-unread-divider" ]
                    ]
                    ()
        , test "thread shows the beginning intro once history exhausts" <|
            \_ ->
                let
                    exhausted =
                        markHistoryExhausted channelModel "#c"
                in
                Expect.all
                    [ \_ ->
                        query exhausted
                            |> Query.has [ Selector.text "This is the very beginning of the conversation." ]
                    , \_ ->
                        query channelModel
                            |> Query.hasNot [ Selector.text "This is the very beginning of the conversation." ]
                    ]
                    ()
        , test "rail lists the joined channel" <|
            \_ ->
                query channelModel
                    |> Query.has [ Selector.class "onyx-rail", Selector.text "#c" ]
        , test "roster groups ops, voice, and members with counts" <|
            \_ ->
                let
                    q =
                        query channelModel
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.text "Ops (1)" ] q
                    , \_ -> Query.has [ Selector.text "Voice (1)" ] q
                    , \_ -> Query.has [ Selector.text "Members (1)" ] q
                    ]
                    ()
        , test "roster marks away members and resolves learned ranks" <|
            \_ ->
                let
                    away =
                        feed channelModel ":bob!u@h AWAY :lunch"

                    q =
                        query away
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-away" ] q
                    , \_ ->
                        Query.findAll [ Selector.class "onyx-member-prefix" ] q
                            |> Query.first
                            |> Query.has [ Selector.text "@" ]
                    ]
                    ()
        , test "topbar identity chip names the nick without a badge" <|
            \_ ->
                let
                    q =
                        query channelModel
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-ident", Selector.text "me" ] q
                    , \_ -> Query.hasNot [ Selector.class "onyx-ident-badge" ] q
                    , \_ -> Query.hasNot [ Selector.class "onyx-ident-guest" ] q
                    ]
                    ()
        , test "topbar flags an enforced guest rename" <|
            \_ ->
                let
                    q =
                        query (feed channelModel ":me!u@h NICK Guest123")

                    chip =
                        Query.find [ Selector.class "onyx-ident" ] q
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-ident-guest" ] q
                    , \_ ->
                        chip
                            |> Query.has
                                [ Selector.text "Guest123"
                                , Selector.text "alias"
                                , Selector.attribute
                                    (Attr.title "The server moved you to Guest123: your nick is protected — sign in to reclaim it.")
                                ]
                    ]
                    ()
        , test "identity chip offers reclaim while parked on an alias" <|
            \_ ->
                let
                    parked =
                        { channelModel | currentNickIsAlias = True, accountName = Just "alice" }

                    q =
                        query parked

                    shut =
                        query channelModel
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-ident-action" ] q
                    , \_ ->
                        Query.find [ Selector.class "onyx-ident-action" ] q
                            |> Query.has [ Selector.text "alias" ]
                    , \_ -> Query.hasNot [ Selector.class "onyx-reclaim" ] q
                    , \_ -> Query.hasNot [ Selector.class "onyx-ident-action" ] shut
                    ]
                    ()
        , test "reclaim dialog gates submit on the password" <|
            \_ ->
                let
                    parked =
                        { channelModel | currentNickIsAlias = True, accountName = Just "alice" }

                    gated =
                        query { parked | reclaimOpen = True }

                    typed =
                        query { parked | reclaimOpen = True, reclaimPassword = "s3cret" }

                    submit =
                        Query.find [ Selector.class "onyx-reclaim-submit" ]
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-reclaim" ] gated
                    , \_ -> Query.has [ Selector.text "take this name back" ] gated
                    , \_ ->
                        submit gated
                            |> Query.has [ Selector.disabled True ]
                    , \_ ->
                        submit typed
                            |> Query.has [ Selector.disabled False ]
                    , \_ -> Query.has [ Selector.text "Cancel" ] typed
                    ]
                    ()
        , test "composer offers the audience toggle on advertised channels" <|
            \_ ->
                let
                    statusSupport =
                        Isupport.applyIsupportToken channelModel.isupport "STATUSMSG" "!.@+"

                    offered =
                        query { channelModel | isupport = statusSupport }

                    aimed =
                        query { channelModel | isupport = statusSupport, composerAudience = Just '@' }

                    plain =
                        query channelModel
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-audience-toggle" ] offered
                    , \_ ->
                        Query.find [ Selector.class "onyx-audience-toggle" ] offered
                            |> Query.has [ Selector.text "Everyone" ]
                    , \_ ->
                        Query.find [ Selector.class "onyx-audience-toggle" ] aimed
                            |> Query.has
                                [ Selector.text "Ops"
                                , Selector.class "onyx-audience-toggle-set"
                                ]
                    , \_ -> Query.hasNot [ Selector.class "onyx-audience-toggle" ] plain
                    ]
                    ()
        , test "status rows carry the audience badge" <|
            \_ ->
                let
                    statusSupport =
                        Isupport.applyIsupportToken channelModel.isupport "STATUSMSG" "!.@+"

                    q =
                        query
                            (feed { channelModel | isupport = statusSupport }
                                ":alice!u@h PRIVMSG @#c :ops hello"
                            )

                    badge =
                        Query.find [ Selector.class "onyx-audience" ] q
                in
                Expect.all
                    [ \_ -> Query.has [ Selector.class "onyx-audience" ] q
                    , \_ ->
                        badge
                            |> Query.has
                                [ Selector.text "Ops"
                                , Selector.attribute
                                    (Attr.title "Only visible to ops")
                                ]
                    ]
                    ()
        , test "clicking a rail channel selects it" <|
            \_ ->
                let
                    twoChannel =
                        feed channelModel ":me!u@h JOIN #b"
                in
                query twoChannel
                    |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "#b" ] ]
                    |> Event.simulate Event.click
                    |> Event.expect (ChannelSelect "#b")
        , test "rail stamps pending offline memos on DM rows" <|
            \_ ->
                let
                    one =
                        feed channelModel ":s NOTE MEMO :from bob :hello"

                    two =
                        feed one ":s NOTE MEMO :from bob :again"
                in
                Expect.all
                    [ \_ ->
                        query one
                            |> Query.find [ Selector.class "onyx-rail-offline" ]
                            |> Query.has [ Selector.text "1 offline" ]
                    , \_ ->
                        query two
                            |> Query.find [ Selector.class "onyx-rail-offline" ]
                            |> Query.has [ Selector.text "2 offline" ]
                    ]
                    ()
        , test "channel rows never carry the offline stamp" <|
            \_ ->
                let
                    memoed =
                        feed channelModel ":s NOTE MEMO :from bob :hello"

                    opened =
                        Tuple.first (update (ChannelSelect "bob") memoed)
                in
                Expect.all
                    [ \_ ->
                        query channelModel
                            |> Query.hasNot [ Selector.class "onyx-rail-offline" ]
                    , \_ ->
                        query opened
                            |> Query.hasNot [ Selector.class "onyx-rail-offline" ]
                    ]
                    ()
        , test "rail badges background unread with mention styling" <|
            \_ ->
                let
                    unread =
                        channelModel
                            |> (\m -> feed m ":me!u@h JOIN #b")
                            |> (\m -> feed m ":bob!u@h JOIN #b")
                            |> (\m -> feed m ":bob!u@h PRIVMSG #b :me, look")

                    q =
                        query unread
                in
                Expect.all
                    [ \_ ->
                        q
                            |> Query.find [ Selector.class "onyx-rail-unread" ]
                            |> Query.has [ Selector.class "onyx-rail-mention", Selector.text "1" ]
                    , \_ ->
                        query channelModel
                            |> Query.hasNot [ Selector.class "onyx-rail-unread" ]
                    ]
                    ()
        , describe "room care"
            [ test "management view shows ranks, helpers, and owner sections" <|
                \_ ->
                    let
                        q =
                            query stewardModel
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] q
                                |> Query.has [ Selector.text "Room care" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-ranks") ] q
                                |> Query.has [ Selector.text "Owner: alice · Helpers: bob" ]
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "steward-helper-row") ] q
                                |> Query.count (Expect.equal 1)
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] q
                                |> Query.has [ Selector.text "Hand the room to someone" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] q
                                |> Query.has [ Selector.text "Close this room" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] q
                                |> Query.has [ Selector.text "Delete this room" ]
                        ]
                        ()
            , test "take view offers accept or decline" <|
                \_ ->
                    let
                        offered =
                            { stewardModel
                                | ourNick = "drew"
                                , roomTransfers =
                                    Dict.singleton "#harbor"
                                        { channel = "#harbor", from = "alice", to = "drew", accepted = False }
                            }

                        q =
                            query offered
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] q
                                |> Query.has [ Selector.text "Take #harbor?" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] q
                                |> Query.has [ Selector.text "alice wants you to take this room" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-accept") ] q
                                |> Query.has [ Selector.text "Accept" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-decline") ] q
                                |> Query.has [ Selector.text "Not now" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] q
                                |> Query.hasNot [ Selector.text "Delete this room" ]
                        ]
                        ()
            , test "non-owners see no mutating sections" <|
                \_ ->
                    let
                        q =
                            query { stewardModel | ourNick = "drew" }
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] q
                                |> Query.hasNot [ Selector.attribute (Attr.attribute "data-testid" "steward-helper-input") ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] q
                                |> Query.hasNot [ Selector.text "Delete this room" ]
                        ]
                        ()
            , test "closed or missing rooms render nothing" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ] (query blank)
                                |> Query.count (Expect.equal 0)
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "steward-panel") ]
                                (query { stewardModel | stewardRoom = Just "#gone" })
                                |> Query.count (Expect.equal 0)
                        ]
                        ()
            , test "roster gates the Room care entry on the 3-30 band" <|
                \_ ->
                    let
                        pair =
                            { stewardChannel | name = "#pair", members = Dict.fromList [ ( "alice", { nick = "alice", modes = Set.empty, away = False } ), ( "bob", { nick = "bob", modes = Set.empty, away = False } ) ] }

                        small =
                            { stewardModel | activeChannel = Just "#pair", channels = Dict.singleton "#pair" pair }
                    in
                    Expect.all
                        [ \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "steward-open") ] (query stewardModel)
                                |> Query.count (Expect.equal 1)
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "steward-open") ] (query small)
                                |> Query.count (Expect.equal 0)
                        ]
                        ()
            ]
        , describe "ban add form"
            [ test "raw form renders with minutes default" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            query banOpModel
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ban-add-form") ]
                                |> Query.has [ Selector.text "Add a timed block" ]
                        , \_ ->
                            query banOpModel
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ban-add-minutes") ]
                                |> Query.has [ Selector.attribute (Attr.attribute "value" "60") ]
                        ]
                        ()
            , test "extban builder previews the validated mask" <|
                \_ ->
                    let
                        base =
                            banOpModel.banAdd

                        ext =
                            { banOpModel
                                | banAdd =
                                    { base | useExtBan = True, extType = "a", extPattern = "alice" }
                            }

                        invalid =
                            { banOpModel
                                | banAdd =
                                    { base | useExtBan = True, extType = "a", extPattern = "" }
                            }
                    in
                    Expect.all
                        [ \_ ->
                            query ext
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ban-add-preview") ]
                                |> Query.has [ Selector.text "Will add: $a:alice" ]
                        , \_ ->
                            query invalid
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ban-add-preview") ]
                                |> Query.has [ Selector.text "Does not validate" ]
                        ]
                        ()
            ]
        , describe "ban desk"
            [ test "populated panel lists masks with review buttons" <|
                \_ ->
                    let
                        q =
                            query banOpModel
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "ban-list-panel") ] q
                                |> Query.has [ Selector.text "Active blocks" ]
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "ban-list-row") ] q
                                |> Query.count (Expect.equal 1)
                        , \_ ->
                            Query.has [ Selector.text "*!*@bad.example", Selector.text "Set by alice" ] q
                        , \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Review lift" ] ] q
                                |> Event.simulate Event.click
                                |> Event.expect (UnbanReviewRequested { channel = "#c", mask = "*!*@bad.example" })
                        ]
                        ()
            , test "loading and empty states use the oracle copy" <|
                \_ ->
                    let
                        loading =
                            query
                                { banOpModel
                                    | banList = Dict.empty
                                    , banListMeta = Dict.singleton "#c" (banMeta BanLoading)
                                }

                        refreshing =
                            query { banOpModel | banListMeta = Dict.singleton "#c" (banMeta BanLoading) }

                        empty =
                            query
                                { banOpModel
                                    | banList = Dict.singleton "#c" { order = 0, entries = [] }
                                    , banListMeta = Dict.singleton "#c" (banMeta BanReady)
                                }
                    in
                    Expect.all
                        [ \_ -> Query.has [ Selector.text "Loading the block list…" ] loading
                        , \_ -> Query.has [ Selector.text "Refreshing the block list…" ] refreshing
                        , \_ -> Query.has [ Selector.text "No active blocks in this room." ] empty
                        ]
                        ()
            , test "non-moderators see no panel" <|
                \_ ->
                    query banVoiceModel
                        |> Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "ban-list-panel") ]
                        |> Query.count (Expect.equal 0)
            , test "offline moderators get a disabled refresh" <|
                \_ ->
                    query { banOpModel | connection = Offline }
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "ban-list-refresh") ]
                        |> Query.has [ Selector.disabled True ]
            , test "pending review renders a confirm dialog" <|
                \_ ->
                    let
                        q =
                            query
                                { banOpModel
                                    | pendingUnban = Just { channel = "#c", mask = "*!*@bad.example", account = Nothing, endpoint = Nothing }
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Lift the block on *!*@bad.example in #c?" ] q
                        , \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Lift block" ] ] q
                                |> Event.simulate Event.click
                                |> Event.expect UnbanReviewConfirmed
                        , \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Keep block" ] ] q
                                |> Event.simulate Event.click
                                |> Event.expect UnbanReviewCancelled
                        ]
                        ()
            ]
        , describe "notification inbox"
            [ test "bell badges attention unread only" <|
                \_ ->
                    let
                        q =
                            query { inboxModel | showNotificationCenter = False }

                        allRead =
                            query
                                { inboxModel
                                    | showNotificationCenter = False
                                    , readNotificationIds = Set.fromList [ "notif-0", "notif-1" ]
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "inbox-bell") ] q
                                |> Query.has [ Selector.text "1" ]
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "inbox-panel") ] q
                                |> Query.count (Expect.equal 0)
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "inbox-badge") ] allRead
                                |> Query.count (Expect.equal 0)
                        ]
                        ()
            , test "open panel lists newest first with filters" <|
                \_ ->
                    let
                        q =
                            query inboxModel
                    in
                    Expect.all
                        [ \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "inbox-row") ] q
                                |> Query.count (Expect.equal 2)
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "inbox-row") ] q
                                |> Query.first
                                |> Query.has [ Selector.text "Nickname in use: taken", Selector.text "Error" ]
                        , \_ ->
                            Query.has [ Selector.text "All (2)", Selector.text "Needs you (1)", Selector.text "Other (1)" ] q
                        , \_ ->
                            Query.has [ Selector.text "alice in #c", Selector.text "@" ] q
                        ]
                        ()
            , test "row actions dispatch inbox messages" <|
                \_ ->
                    let
                        q =
                            query inboxModel
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Nickname in use: taken" ] ] q
                                |> Event.simulate Event.click
                                |> Event.expect (NotificationActivated "notif-1")
                        , \_ ->
                            Query.findAll [ Selector.class "notif-center__dismiss" ] q
                                |> Query.first
                                |> Event.simulate Event.click
                                |> Event.expect (NotificationDismissed "notif-1")
                        , \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Mark all read" ] ] q
                                |> Event.simulate Event.click
                                |> Event.expect NotificationsMarkedRead
                        ]
                        ()
            , test "empty and filtered-empty copy" <|
                \_ ->
                    let
                        empty =
                            query { blank | showNotificationCenter = True }

                        filtered =
                            query { inboxModel | inboxFilter = InboxOther }
                    in
                    Expect.all
                        [ \_ -> Query.has [ Selector.text "Nothing yet — mentions and messages land here." ] empty
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "inbox-row") ] filtered
                                |> Query.count (Expect.equal 1)
                        ]
                        ()
            ]
        , describe "scheduled sheet and send-later"
            [ test "sheet stays hidden until opened, then shows the empty copy" <|
                \_ ->
                    let
                        closed =
                            query blank

                        opened =
                            query { blank | showScheduledMessages = True }
                    in
                    Expect.all
                        [ \_ ->
                            Query.findAll [ Selector.class "onyx-scheduled" ] closed
                                |> Query.count (Expect.equal 0)
                        , \_ -> Query.has [ Selector.text "No scheduled messages." ] opened
                        , \_ -> Query.has [ Selector.text "Use Send later in the composer to keep a message on this device until later." ] opened
                        ]
                        ()
            , test "open sheet lists owned rows with live state and per-row cancel" <|
                \_ ->
                    let
                        owner =
                            Just { serverUrl = "wss://irc.example", identity = "kai" }

                        rows =
                            [ { id = "s1", channel = "#c", text = "later", sendAt = 5000000, owner = owner, claim = Nothing, generation = Nothing, clearEpoch = Nothing }
                            , { id = "s2", channel = "bob", text = "dm later", sendAt = 6000000, owner = owner, claim = Just { token = "claim-1", claimedAt = 9 }, generation = Nothing, clearEpoch = Nothing }
                            ]

                        model =
                            { blank
                                | endpoint = Just "wss://irc.example"
                                , ourNick = "kai"
                                , scheduledMessages = rows
                                , showScheduledMessages = True
                                , nowMs = 1000000
                            }

                        q =
                            query model

                        sheet =
                            Query.find [ Selector.class "onyx-scheduled" ] q
                    in
                    Expect.all
                        [ \_ ->
                            Query.findAll [ Selector.class "onyx-scheduled-item" ] sheet
                                |> Query.count (Expect.equal 2)
                        , \_ -> Query.has [ Selector.text "Room · #c", Selector.text "Direct message · bob" ] sheet
                        , \_ -> Query.has [ Selector.text "Saved; waiting for its time", Selector.text "Sending; delivery is uncertain" ] sheet
                        , \_ -> Query.has [ Selector.text "Room ledger", Selector.text "Cancel", Selector.text "Remove row" ] sheet
                        , \_ -> Query.has [ Selector.text "Sending was attempted. Removing this row cannot confirm or undo delivery." ] sheet
                        , \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Cancel" ] ] sheet
                                |> Event.simulate Event.click
                                |> Event.expect (CancelScheduledMessage { id = "s1" })
                        , \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Remove row" ] ] sheet
                                |> Event.simulate Event.click
                                |> Event.expect (CancelScheduledMessage { id = "s2" })
                        , \_ ->
                            Query.find [ Selector.class "onyx-scheduled-close" ] sheet
                                |> Event.simulate Event.click
                                |> Event.expect (SetShowScheduledMessages False)
                        ]
                        ()
            , test "composer send-later disables with reason and opens the picker" <|
                \_ ->
                    let
                        noTarget =
                            query blank

                        ready =
                            query { blank | activeChannel = Just "#c", composer = "later" }

                        open =
                            query { blank | activeChannel = Just "#c", composer = "later", scheduleOpen = True, scheduleMinLocal = "2025-06-15T07:12" }

                        popover =
                            Query.find [ Selector.class "onyx-schedule-pop" ] open
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Send later" ] ] noTarget
                                |> Query.has [ Selector.disabled True, Selector.attribute (Attr.title "Choose a room or message to schedule.") ]
                        , \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Send later" ] ] ready
                                |> Event.simulate Event.click
                                |> Event.expect ScheduleOpen
                        , \_ ->
                            Query.has
                                [ Selector.text "In 15 minutes"
                                , Selector.text "In 1 hour"
                                , Selector.text "In 3 hours"
                                , Selector.text "Tomorrow, 9:00"
                                , Selector.text "View 0 scheduled"
                                ]
                                popover
                        , \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "In 15 minutes" ] ] popover
                                |> Event.simulate Event.click
                                |> Event.expect (SchedulePresetClicked { id = "in-15m" })
                        , \_ ->
                            Query.find [ Selector.tag "input", Selector.attribute (Attr.type_ "datetime-local") ] popover
                                |> Event.simulate (Event.input "2030-01-01T10:00")
                                |> Event.expect (ScheduleWhenInput "2030-01-01T10:00")
                        , \_ ->
                            Query.find [ Selector.tag "button", Selector.containing [ Selector.text "View 0 scheduled" ] ] popover
                                |> Event.simulate Event.click
                                |> Event.expect ScheduleViewQueue
                        ]
                        ()
            ]
        , describe "toaster"
            [ test "danger row carries alert role and dismiss label" <|
                \_ ->
                    let
                        seeded =
                            addToast
                                { variant = ToastError
                                , title = "Send failed"
                                , description = Just "The wire dropped it."
                                , duration = Nothing
                                , groupKey = Nothing
                                , undo = Nothing
                                }
                                0
                                blank

                        q =
                            query seeded
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.class "onyx-toaster" ] q
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-live" "polite") ]
                        , \_ ->
                            Query.find [ Selector.class "onyx-toast--danger" ] q
                                |> Query.has [ Selector.text "Send failed", Selector.text "The wire dropped it." ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "aria-label" "Dismiss Send failed") ] q
                                |> Query.has [ Selector.text "×" ]
                        ]
                        ()
            , test "undo row offers an Undo control" <|
                \_ ->
                    let
                        seeded =
                            addToast
                                { variant = ToastUndo
                                , title = "Blocked kai"
                                , description = Nothing
                                , duration = Nothing
                                , groupKey = Nothing
                                , undo = Just (UndoUnignoreUser "kai")
                                }
                                0
                                blank
                    in
                    Query.find [ Selector.class "onyx-toast__undo" ] (query seeded)
                        |> Query.has [ Selector.text "Undo" ]
            , test "empty toasts render an empty live region" <|
                \_ ->
                    Query.findAll [ Selector.class "onyx-toast" ] (query blank)
                        |> Query.count (Expect.equal 0)
            ]
        , describe "guest claim"
            [ test "guest chip offers to keep the nick" <|
                \_ ->
                    let
                        q =
                            query { blank | ourNick = "kai", endpoint = Just "wss://irc.example" }
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "guest-claim") ] q
                                |> Query.has [ Selector.text "kai" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "guest-claim-open") ] q
                                |> Query.has [ Selector.text "Keep" ]
                        ]
                        ()
            , test "authed account hides the chip" <|
                \_ ->
                    Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "guest-claim") ]
                        (query { blank | ourNick = "kai", accountName = Just "kai" })
                        |> Query.count (Expect.equal 0)
            , test "open sheet shows the register form" <|
                \_ ->
                    let
                        q =
                            query
                                { blank
                                    | ourNick = "kai"
                                    , endpoint = Just "wss://irc.example"
                                    , guestClaimOpen = True
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "guest-claim-sheet") ] q
                                |> Query.has [ Selector.text "You stay connected while it is set up." ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "guest-claim-form") ] q
                                |> Query.has [ Selector.text "Create account" ]
                        ]
                        ()
            , test "verifying sheet shows the code form" <|
                \_ ->
                    let
                        q =
                            query
                                { blank
                                    | ourNick = "kai"
                                    , endpoint = Just "wss://irc.example"
                                    , guestClaimOpen = True
                                    , guestClaimPhase = ClaimVerifying
                                }
                    in
                    Query.find [ Selector.attribute (Attr.attribute "data-testid" "guest-claim-verify-form") ] q
                        |> Query.has [ Selector.text "Verify" ]
            ]
        , describe "room browser"
            [ test "browse sheet lists directory rows with actions" <|
                \_ ->
                    let
                        seeded =
                            { blank
                                | ourNick = "kai"
                                , endpoint = Just "wss://irc.example"
                                , browserOpen = True
                                , channelList =
                                    [ { name = "#hall", count = 9, topic = "general chat" }
                                    , { name = "#tiny", count = 1, topic = "" }
                                    ]
                            }

                        q =
                            query seeded
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "aria-label" "Browse rooms") ] q
                                |> Query.has [ Selector.text "Browse rooms" ]
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-room-card" "") ] q
                                |> Query.count (Expect.equal 1)
                        , \_ ->
                            Query.find [ Selector.class "chb-name" ] q
                                |> Query.has [ Selector.text "#hall" ]
                        , \_ ->
                            Query.find [ Selector.class "chb-ledger" ] q
                                |> Query.has [ Selector.attribute (Attr.attribute "href" "/stats/?room=%23hall") ]
                        , \_ ->
                            Query.find [ Selector.class "chb-join" ] q
                                |> Query.has [ Selector.text "Join" ]
                        ]
                        ()
            , test "browse search finds soft rooms; sort toggle flips" <|
                \_ ->
                    let
                        base =
                            { blank
                                | ourNick = "kai"
                                , endpoint = Just "wss://irc.example"
                                , browserOpen = True
                                , channelList =
                                    [ { name = "#hall", count = 9, topic = "general chat" }
                                    , { name = "#tiny", count = 1, topic = "" }
                                    ]
                            }

                        searched =
                            query { base | browserQuery = "tiny" }

                        sorted =
                            query { base | browserSort = SortName }
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.class "chb-name" ] searched
                                |> Query.has [ Selector.text "#tiny" ]
                        , \_ ->
                            Query.find [ Selector.class "chb-count--started" ] searched
                                |> Query.has [ Selector.text "Just started" ]
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "aria-pressed" "true") ] sorted
                                |> Query.count (Expect.equal 1)
                        ]
                        ()
            ]
        , describe "room formation sheet"
            [ test "create mode renders the formation loop" <|
                \_ ->
                    let
                        q =
                            query { blank | browserOpen = True, browserMode = CreateMode, createName = "friends" }
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "create-room-formation") ] q
                                |> Query.has [ Selector.text "Start a room" ]
                        , \_ ->
                            Query.findAll [ Selector.class "chb-skin" ] q
                                |> Query.count (Expect.equal 3)
                        , \_ ->
                            Query.find [ Selector.class "chb-invite-progress" ] q
                                |> Query.has [ Selector.text "0 of 3 people added." ]
                        , \_ ->
                            Query.find [ Selector.class "chb-submit" ] q
                                |> Query.has [ Selector.text "Create and enter room" ]
                        ]
                        ()
            , test "browse mode hides the formation loop" <|
                \_ ->
                    let
                        q =
                            query { blank | browserOpen = True, browserMode = BrowseMode }
                    in
                    Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "create-room-formation") ] q
                        |> Query.count (Expect.equal 0)
            ]
        , describe "calls hub"
            [ test "idle hub shows discovery copy with no join controls" <|
                \_ ->
                    let
                        q =
                            query { blank | callsOpen = True }
                    in
                    Expect.all
                        [ \_ -> Query.has [ Selector.text "Talk where the conversation already lives." ] q
                        , \_ -> Query.has [ Selector.text "Choose a room" ] q
                        , \_ -> Query.find [ Selector.class "onyx-calls" ] q |> Query.findAll [ Selector.tag "button" ] |> Query.count (Expect.equal 1)
                        ]
                        ()
            , test "incoming ringing never claims established" <|
                \_ ->
                    let
                        calls =
                            { lifecycle = Media.RingingIn
                            , channel = Just "#room"
                            , withPeer = ""
                            , startedAt = Nothing
                            , outcome = Nothing
                            }

                        q =
                            query { blank | callsOpen = True, calls = calls }
                    in
                    Expect.all
                        [ \_ -> Query.has [ Selector.text "Incoming call" ] q
                        , \_ -> Query.has [ Selector.text "Incoming" ] q
                        , \_ ->
                            Query.findAll [ Selector.text "Your call is still here." ] q
                                |> Query.count (Expect.equal 0)
                        , \_ -> Query.find [ Selector.class "onyx-calls" ] q |> Query.findAll [ Selector.tag "button" ] |> Query.count (Expect.equal 1)
                        ]
                        ()
            , test "established call offers return without starting anything" <|
                \_ ->
                    let
                        calls =
                            { lifecycle = Media.InCall
                            , channel = Just "#room"
                            , withPeer = ""
                            , startedAt = Just 1700000000000
                            , outcome = Just Media.CallEnded
                            }

                        q =
                            query { blank | callsOpen = True, calls = calls }
                    in
                    Expect.all
                        [ \_ -> Query.has [ Selector.text "Your call is still here." ] q
                        , \_ ->
                            query { blank | callsOpen = True, calls = calls }
                                |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Return to call" ] ]
                                |> Event.simulate Event.click
                                |> Event.expect (CallsReturnToCall "#room")
                        , \_ ->
                            -- A live call wins over history: no outcome shown.
                            Query.findAll [ Selector.text "That call ended." ] q
                                |> Query.count (Expect.equal 0)
                        ]
                        ()
            , test "idle outcome is acknowledged, not vanished" <|
                \_ ->
                    let
                        calls =
                            { lifecycle = Media.Idle
                            , channel = Nothing
                            , withPeer = ""
                            , startedAt = Nothing
                            , outcome = Just Media.CallDropped
                            }
                    in
                    query { blank | callsOpen = True, calls = calls }
                        |> Query.has [ Selector.text "The connection dropped." ]
            , test "idle hub with an open room offers voice and video join" <|
                \_ ->
                    let
                        q =
                            query { blank | callsOpen = True, activeChannel = Just "#room" }
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Join call in #room" ] ]
                                |> Event.simulate Event.click
                                |> Event.expect (CallJoin { channel = "#room", video = False })
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Join with video in #room" ] ]
                                |> Event.simulate Event.click
                                |> Event.expect (CallJoin { channel = "#room", video = True })
                        ]
                        ()
            , test "live call offers mute and leave" <|
                \_ ->
                    let
                        calls =
                            { lifecycle = Media.InCall
                            , channel = Just "#room"
                            , withPeer = ""
                            , startedAt = Just 1700000000000
                            , outcome = Nothing
                            }

                        q =
                            query { blank | callsOpen = True, calls = calls }
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Mute" ] ]
                                |> Event.simulate Event.click
                                |> Event.expect CallToggleMute
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Leave call" ] ]
                                |> Event.simulate Event.click
                                |> Event.expect CallLeave
                        ]
                        ()
            , test "topbar calls button toggles the hub" <|
                \_ ->
                query blank
                    |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Calls" ] ]
                    |> Event.simulate Event.click
                    |> Event.expect ToggleCalls
            ]
        , describe "landing"
            [ test "landing renders hero, trust, board, and shelf" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Landing }
                    in
                    Expect.all
                        [ \_ -> Query.has [ Selector.text "Good company." ] q
                        , \_ -> Query.has [ Selector.text "Great nights." ] q
                        , \_ -> Query.has [ Selector.text "No ads" ] q
                        , \_ -> Query.has [ Selector.text "Meet people" ] q
                        , \_ -> Query.has [ Selector.text "More to explore" ] q
                        , \_ ->
                            Query.find [ Selector.tag "a", Selector.containing [ Selector.text "Open Onyx" ] ] q
                                |> Query.has [ Selector.attribute (Attr.href "/app/") ]
                        ]
                        ()
            , test "board tabs switch the panel" <|
                \_ ->
                    let
                        switched =
                            Tuple.first (update (SelectBoardTab "bring-people") { blank | route = Route.Landing })
                    in
                    Expect.all
                        [ \_ ->
                            query switched
                                |> Query.has [ Selector.text "Bring your people along." ]
                        , \_ ->
                            query { blank | route = Route.Landing }
                                |> Query.has [ Selector.text "Walk into the public room." ]
                        ]
                        ()
            , test "landing carries the public title" <|
                \_ ->
                    View.view { blank | route = Route.Landing }
                        |> .title
                        |> Expect.equal "Onyx — good company. Great nights."
            ]
        , describe "public frame"
            [ test "unknown routes render the 404 terminus in the frame" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.NotFound, navPath = "/nope" }
                    in
                    Expect.all
                        [ \_ -> Query.has [ Selector.text "Route terminus" ] q
                        , \_ -> Query.has [ Selector.text "This route is not part of the public Onyx surface." ] q
                        , \_ -> Query.has [ Selector.text "Back to home" ] q
                        , \_ -> Query.has [ Selector.text "Skip to content" ] q
                        , \_ -> Query.has [ Selector.text "Open Onyx" ] q
                        , \_ -> Query.has [ Selector.text "Explore Onyx" ] q
                        ]
                        ()
            , test "app misses offer the app" <|
                \_ ->
                    query { blank | route = Route.NotFound, navPath = "/app/room" }
                        |> Query.find [ Selector.class "not-found-page__action" ]
                        |> Query.has [ Selector.text "Open Onyx", Selector.attribute (Attr.href "/app/") ]
            , test "terminus carries the route title" <|
                \_ ->
                    View.view { blank | route = Route.NotFound }
                        |> .title
                        |> Expect.equal "Route terminus — Onyx"
            , test "menu toggle dispatches and opens the nav" <|
                \_ ->
                    let
                        opened =
                            Tuple.first (update ToggleNavMenu { blank | route = Route.NotFound })
                    in
                    Expect.all
                        [ \_ ->
                            query { blank | route = Route.NotFound }
                                |> Query.find [ Selector.class "public-frame__menu-toggle" ]
                                |> Event.simulate Event.click
                                |> Event.expect ToggleNavMenu
                        , \_ -> Expect.equal True opened.navMenuOpen
                        , \_ ->
                            query opened
                                |> Query.find [ Selector.id "public-primary-navigation" ]
                                |> Query.has [ Selector.class "is-open" ]
                        ]
                        ()
            , test "escape and navigation close the menu and record the path" <|
                \_ ->
                    let
                        opened =
                            Tuple.first (update ToggleNavMenu blank)

                        escaped =
                            Tuple.first (update NavMenuEscape opened)
                    in
                    Expect.all
                        [ \_ -> Expect.equal False escaped.navMenuOpen
                        , \_ ->
                            case Url.fromString "http://example.com/app/room" of
                                Just url ->
                                    let
                                        ( navigated, _ ) =
                                            update (UrlChanged url) opened
                                    in
                                    Expect.all
                                        [ \_ -> Expect.equal False navigated.navMenuOpen
                                        , \_ -> Expect.equal "/app/room" navigated.navPath
                                        ]
                                        ()

                                Nothing ->
                                    Expect.fail "bad test url"
                        ]
                        ()
            , test "normalisePath matches the manifest slashless keys" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "/" (normalisePath "/")
                        , \_ -> Expect.equal "/about" (normalisePath "/about/")
                        , \_ -> Expect.equal "/about" (normalisePath "/about")
                        , \_ -> Expect.equal "/a" (normalisePath "/a?x=1#f")
                        , \_ -> Expect.equal "/" (normalisePath "")
                        ]
                        ()
            , test "priorityFromFragment mirrors roadmapPriorityFromHash" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (priorityFromFragment Nothing)
                        , \_ -> Expect.equal (Just "now") (priorityFromFragment (Just "roadmap-now"))
                        , \_ -> Expect.equal (Just "next") (priorityFromFragment (Just "#roadmap-next"))
                        , \_ -> Expect.equal (Just "later") (priorityFromFragment (Just "roadmap-later"))
                        , \_ -> Expect.equal Nothing (priorityFromFragment (Just "roadmap-soon"))
                        , \_ -> Expect.equal Nothing (priorityFromFragment (Just ""))
                        , \_ -> Expect.equal Nothing (priorityFromFragment (Just "now"))
                        ]
                        ()
            , test "SelectRoadmapPriority keeps only known states" <|
                \_ ->
                    let
                        selected =
                            Tuple.first (update (SelectRoadmapPriority { state = "next" }) blank)

                        forged =
                            Tuple.first (update (SelectRoadmapPriority { state = "soon" }) selected)
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "next") selected.roadmapPriority
                        , \_ -> Expect.equal (Just "next") forged.roadmapPriority
                        , \_ -> Expect.equal [] (Tuple.second (update (SelectRoadmapPriority { state = "next" }) blank))
                        ]
                        ()
            , test "navigation syncs the roadmap priority from the fragment" <|
                \_ ->
                    case ( Url.fromString "http://example.com/roadmap/#roadmap-later", Url.fromString "http://example.com/roadmap/" ) of
                        ( Just fragUrl, Just plainUrl ) ->
                            let
                                withFrag =
                                    Tuple.first (update (UrlChanged fragUrl) blank)

                                cleared =
                                    Tuple.first (update (UrlChanged plainUrl) withFrag)
                            in
                            Expect.all
                                [ \_ -> Expect.equal (Just "later") withFrag.roadmapPriority
                                , \_ -> Expect.equal Route.Roadmap withFrag.route
                                , \_ -> Expect.equal Nothing cleared.roadmapPriority
                                ]
                                ()

                        _ ->
                            Expect.fail "bad test url"
            , test "public info pages resolve the allowlist and render" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just View.PublicInfo.Accessibility) (View.PublicInfo.pageForPath "/accessibility/")
                        , \_ -> Expect.equal (Just View.PublicInfo.Glossary) (View.PublicInfo.pageForPath "/glossary")
                        , \_ -> Expect.equal (Just View.PublicInfo.Integrations) (View.PublicInfo.pageForPath "/integrations/")
                        , \_ -> Expect.equal (Just View.PublicInfo.Agents) (View.PublicInfo.pageForPath "/agents")
                        , \_ -> Expect.equal Nothing (View.PublicInfo.pageForPath "/about/")
                        , \_ -> Expect.equal Nothing (View.PublicInfo.pageForPath "/ACCESSIBILITY/")
                        , \_ -> Expect.equal "Onyx — Accessibility" (View.PublicInfo.pageTitle View.PublicInfo.Accessibility)
                        , \_ -> Expect.equal "Onyx — Glossary" (View.PublicInfo.pageTitle View.PublicInfo.Glossary)
                        , \_ -> Expect.equal "Onyx — Integrations" (View.PublicInfo.pageTitle View.PublicInfo.Integrations)
                        , \_ -> Expect.equal "Onyx — Agent safety" (View.PublicInfo.pageTitle View.PublicInfo.Agents)
                        , \_ ->
                            View.view { blank | route = Route.Glossary }
                                |> .title
                                |> Expect.equal "Onyx — Glossary"
                        , \_ ->
                            query { blank | route = Route.Agents }
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "Agent safety" ]
                        , \_ ->
                            query { blank | route = Route.Accessibility }
                                |> Query.has [ Selector.text "Report a gap in #accessibility." ]
                        , \_ ->
                            query { blank | route = Route.Integrations }
                                |> Query.has [ Selector.text "It never executes a message as a command." ]
                        ]
                        ()
            , test "about route renders the story and the statement" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.About }
                    in
                    Expect.all
                        [ \_ ->
                            View.view { blank | route = Route.About }
                                |> .title
                                |> Expect.equal "About Onyx — rooms for your people"
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "Rooms for people you already like." ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "figcaption" ]
                                |> Query.has [ Selector.text "This is an explanation, not a live room." ]
                        , \_ ->
                            q
                                |> Query.findAll [ Selector.class "ab-who-card" ]
                                |> Query.count (Expect.equal 3)
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "Read the full accessibility statement" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "a11y-statement-title" ]
                                |> Query.has [ Selector.text "Accessibility statement" ]
                        , \_ ->
                            Expect.equal 5 (List.length accessibilityTopics)
                        , \_ ->
                            q
                                |> Query.findAll [ Selector.class "a11y-topic" ]
                                |> Query.count (Expect.equal 5)
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "a11y-client-surfaces-title" ]
                                |> Query.has [ Selector.text "Current client audit" ]
                        ]
                        ()
            , test "invite query seeds the card and the suggested name" <|
                \_ ->
                    case Url.fromString "http://example.com/invite/?join=%23general&as=yuki" of
                        Just url ->
                            let
                                ( navigated, _ ) =
                                    update (UrlChanged url) blank
                            in
                            Expect.all
                                [ \_ -> Expect.equal Route.Invite navigated.route
                                , \_ -> Expect.equal "yuki" navigated.inviteName
                                , \_ -> Expect.equal (Just "#general") (inviteCard navigated).channel
                                , \_ -> Expect.equal (Just "yuki") (inviteCard navigated).guestName
                                , \_ -> Expect.equal CopyIdle navigated.inviteCopy
                                ]
                                ()

                        Nothing ->
                            Expect.fail "bad test url"
            , test "invite navigation keeps typed text without a suggestion" <|
                \_ ->
                    case Url.fromString "http://example.com/invite/?join=%23general" of
                        Just url ->
                            let
                                typed =
                                    Tuple.first (update (InviteNameInput " typed ") blank)

                                ( navigated, _ ) =
                                    update (UrlChanged url) typed
                            in
                            Expect.all
                                [ \_ -> Expect.equal " typed " navigated.inviteName
                                , \_ -> Expect.equal Nothing (inviteCard navigated).guestName
                                ]
                                ()

                        Nothing ->
                            Expect.fail "bad test url"
            , test "invite name input validates live and gates join" <|
                \_ ->
                    let
                        bad =
                            Tuple.first (update (InviteNameInput "bad nick") blank)

                        ( submitBad, outBad ) =
                            update InviteJoinSubmit bad

                        good =
                            Tuple.first (update (InviteNameInput "yuki") blank)

                        ( _, outGood ) =
                            update InviteJoinSubmit { good | origin = "https://onyx.example" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (bad.inviteNameError /= Nothing)
                        , \_ -> Expect.equal [] outBad
                        , \_ -> Expect.equal True (submitBad.inviteNameError /= Nothing)
                        , \_ -> Expect.equal Nothing good.inviteNameError
                        , \_ ->
                            case outGood of
                                [ LoadUrl href ] ->
                                    Expect.equal True (String.startsWith "/app/?" href)

                                _ ->
                                    Expect.fail "expected a join navigation"
                        ]
                        ()
            , test "invite join link drops inviter and faces, sign-in appends" <|
                \_ ->
                    case Url.fromString "http://example.com/invite/?join=%23lounge&by=river&with=aria" of
                        Just url ->
                            let
                                navigated =
                                    Tuple.first (update (UrlChanged url) blank)

                                join =
                                    inviteJoinHref navigated
                            in
                            Expect.all
                                [ \_ -> Expect.equal False (String.contains "by=" join)
                                , \_ -> Expect.equal False (String.contains "with=" join)
                                , \_ -> Expect.equal True (String.contains "join=%23lounge" join)
                                , \_ -> Expect.equal (join ++ "&signin=1") (inviteSignInHref { navigated | inviteName = "" })
                                ]
                                ()

                        Nothing ->
                            Expect.fail "bad test url"
            , test "invite copy is single-flight with stale-result guard" <|
                \_ ->
                    case Url.fromString "http://example.com/invite/?join=%23general" of
                        Just url ->
                            let
                                navigated =
                                    Tuple.first (update (UrlChanged url) { blank | origin = "https://onyx.example" })

                                ( busy, outBusy ) =
                                    update InviteCopyRequest navigated

                                ( busyAgain, outBusyAgain ) =
                                    update InviteCopyRequest busy

                                ( copied, _ ) =
                                    update (ClipboardResult { tag = "invite", ok = True }) busy

                                ( failed, _ ) =
                                    update (ClipboardResult { tag = "invite", ok = False }) busy

                                ( stale, outStale ) =
                                    update (ClipboardResult { tag = "invite", ok = True }) navigated
                            in
                            Expect.all
                                [ \_ -> Expect.equal CopyBusy busy.inviteCopy
                                , \_ ->
                                    case outBusy of
                                        [ ClipboardCopy req ] ->
                                            Expect.equal "https://onyx.example/invite/?join=%23general" req.text

                                        _ ->
                                            Expect.fail "expected a clipboard copy"
                                , \_ -> Expect.equal [] outBusyAgain
                                , \_ -> Expect.equal CopyCopied copied.inviteCopy
                                , \_ -> Expect.equal CopyFailed failed.inviteCopy
                                , \_ -> Expect.equal CopyIdle stale.inviteCopy
                                , \_ -> Expect.equal [] outStale
                                ]
                                ()

                        Nothing ->
                            Expect.fail "bad test url"
            , test "invite route renders the door with live title" <|
                \_ ->
                    case Url.fromString "http://example.com/invite/?join=%23general&topic=release" of
                        Just url ->
                            let
                                model =
                                    Tuple.first (update (UrlChanged url) blank)

                                q =
                                    query { model | route = Route.Invite }
                            in
                            Expect.all
                                [ \_ ->
                                    View.view { model | route = Route.Invite }
                                        |> .title
                                        |> Expect.equal "Join #general on Onyx"
                                , \_ ->
                                    View.view { blank | route = Route.Invite }
                                        |> .title
                                        |> Expect.equal "Join Onyx"
                                , \_ ->
                                    q
                                        |> Query.find [ Selector.tag "h1" ]
                                        |> Query.has [ Selector.text "#general" ]
                                , \_ ->
                                    q
                                        |> Query.has [ Selector.text "Choose a display name to walk in." ]
                                , \_ ->
                                    q
                                        |> Query.has [ Selector.text "release" ]
                                , \_ ->
                                    q
                                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "invite-join") ]
                                        |> Query.has [ Selector.text "Join" ]
                                , \_ ->
                                    query { blank | route = Route.Invite }
                                        |> Query.has [ Selector.text "This link does not name a room." ]
                                ]
                                ()

                        Nothing ->
                            Expect.fail "bad test url"
            , test "trust pages resolve the allowlist and render" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just View.Trust.Privacy) (trustPageForPath "/privacy/")
                        , \_ -> Expect.equal (Just View.Trust.Privacy) (trustPageForPath "/privacy")
                        , \_ -> Expect.equal (Just View.Trust.Guidelines) (trustPageForPath "/guidelines/")
                        , \_ -> Expect.equal (Just View.Trust.Guidelines) (trustPageForPath "/guidelines")
                        , \_ -> Expect.equal (Just View.Trust.Contact) (trustPageForPath "/contact/")
                        , \_ -> Expect.equal (Just View.Trust.Contact) (trustPageForPath "/contact")
                        , \_ -> Expect.equal Nothing (trustPageForPath "/terms/")
                        , \_ -> Expect.equal Nothing (trustPageForPath "/PRIVACY/")
                        , \_ -> Expect.equal 12 (List.length houseRules)
                        , \_ ->
                            View.view { blank | route = Route.Privacy }
                                |> .title
                                |> Expect.equal "Onyx privacy — what stays here"
                        , \_ ->
                            View.view { blank | route = Route.Guidelines }
                                |> .title
                                |> Expect.equal "Onyx house rules"
                        , \_ ->
                            View.view { blank | route = Route.Contact }
                                |> .title
                                |> Expect.equal "Onyx contact"
                        , \_ ->
                            query { blank | route = Route.Guidelines }
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "House rules" ]
                        , \_ ->
                            query { blank | route = Route.Guidelines }
                                |> Query.findAll [ Selector.tag "li" ]
                                |> Query.count (Expect.equal 12)
                        , \_ ->
                            query { blank | route = Route.Guidelines }
                                |> Query.has [ Selector.text "Onyx is not 911." ]
                        , \_ ->
                            query { blank | route = Route.Privacy }
                                |> Query.has [ Selector.text "Group E2EE is not live." ]
                        , \_ ->
                            query { blank | route = Route.Privacy }
                                |> Query.has [ Selector.text "about 400 recent messages" ]
                        , \_ ->
                            query { blank | route = Route.Contact }
                                |> Query.has [ Selector.text "There is no contact email checked into this repository, so this page does not publish one." ]
                        ]
                        ()
            , test "onyxos stage fold wraps and ignores unknown keys" <|
                \_ ->
                    let
                        select stage =
                            (Tuple.first (update (SelectOnyxosStage { stage = stage }) blank)).onyxosStage

                        step from key =
                            stepOnyxosStage from key
                    in
                    Expect.all
                        [ \_ -> Expect.equal "oracle" blank.onyxosStage
                        , \_ -> Expect.equal "gate" (select "gate")
                        , \_ -> Expect.equal "oracle" (select "bogus")
                        , \_ -> Expect.equal 4 (List.length onyxosStages)
                        , \_ -> Expect.equal "Let the operating system answer back." (stageById "boot").title
                        , \_ -> Expect.equal "implementation" (step "oracle" "ArrowRight")
                        , \_ -> Expect.equal "boot" (step "oracle" "ArrowLeft")
                        , \_ -> Expect.equal "oracle" (step "boot" "ArrowRight")
                        , \_ -> Expect.equal "gate" (step "boot" "ArrowUp")
                        , \_ -> Expect.equal "oracle" (step "gate" "Home")
                        , \_ -> Expect.equal "boot" (step "gate" "End")
                        , \_ -> Expect.equal "gate" (step "gate" "Enter")
                        , \_ -> Expect.equal "gate" (Tuple.first (update (OnyxosStageKey { key = "ArrowRight" }) { blank | onyxosStage = "implementation" })).onyxosStage
                        ]
                        ()
            , test "onyxos route renders the console with the active stage" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Onyxos, onyxosStage = "gate" }
                    in
                    Expect.all
                        [ \_ ->
                            View.view { blank | route = Route.Onyxos }
                                |> .title
                                |> Expect.equal "OnyxOS + Onyx — communication at home in the system"
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "onyxos-method-panel" ]
                                |> Query.has [ Selector.text "A green report is not a shipped binary." ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "onyxos-method-tab-gate" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-selected" "true") ]
                        , \_ ->
                            q
                                |> Query.findAll [ Selector.tag "button", Selector.attribute (Attr.attribute "role" "tab") ]
                                |> Query.count (Expect.equal 4)
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "NTSTATUS" ]
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "pnpm site:check" ]
                        ]
                        ()
            , test "guides plan fold toggles, persists, and shares" <|
                \_ ->
                    let
                        ( toggled, outToggle ) =
                            update (GuidesToggleStep { id = "join" }) blank

                        ( untoggled, _ ) =
                            update (GuidesToggleStep { id = "join" }) toggled

                        ( forged, outForged ) =
                            update (GuidesToggleStep { id = "bogus" }) blank

                        ( reset, outReset ) =
                            update GuidesResetPlan toggled

                        ( copying, outCopy ) =
                            update GuidesCopyPlan toggled

                        ( copied, _ ) =
                            update (ClipboardResult { tag = "guides-plan", ok = True }) copying

                        loaded =
                            Tuple.first
                                (update (GuidesProgressLoaded (Encode.list Encode.string [ "calls", "unknown", "join" ]))
                                    blank
                                )

                        loadedBad =
                            Tuple.first
                                (update (GuidesProgressLoaded (Encode.int 7))
                                    { blank | guidesCompleted = [ "join" ] }
                                )
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "join" ] toggled.guidesCompleted
                        , \_ -> Expect.equal ShareIdle toggled.guidesShare
                        , \_ ->
                            case outToggle of
                                [ GuidesProgressStore req ] ->
                                    Expect.equal [ "join" ] req.ids

                                _ ->
                                    Expect.fail "expected a progress store"
                        , \_ -> Expect.equal [] untoggled.guidesCompleted
                        , \_ -> Expect.equal [] forged.guidesCompleted
                        , \_ -> Expect.equal [] outForged
                        , \_ -> Expect.equal [] reset.guidesCompleted
                        , \_ ->
                            case outReset of
                                [ GuidesProgressStore req ] ->
                                    Expect.equal [] req.ids

                                _ ->
                                    Expect.fail "expected a progress reset store"
                        , \_ -> Expect.equal ShareCopying copying.guidesShare
                        , \_ ->
                            case outCopy of
                                [ ClipboardCopy req ] ->
                                    Expect.equal True (String.contains "1. Join a room — Done" req.text)

                                _ ->
                                    Expect.fail "expected a plan copy"
                        , \_ -> Expect.equal ShareCopied copied.guidesShare
                        , \_ -> Expect.equal [ "join", "calls" ] loaded.guidesCompleted
                        , \_ -> Expect.equal [ "join" ] loadedBad.guidesCompleted
                        ]
                        ()
            , test "guides routes render the plan with live progress" <|
                \_ ->
                    let
                        model =
                            { blank | route = Route.Guides, guidesCompleted = [ "join" ] }

                        q =
                            query model
                    in
                    Expect.all
                        [ \_ ->
                            View.view model
                                |> .title
                                |> Expect.equal "Onyx guides — join a room in the official app"
                        , \_ ->
                            View.view { blank | route = Route.Community }
                                |> .title
                                |> Expect.equal "Onyx community — how to join and be here"
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "Getting started" ]
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "1 of 5" ]
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "Next: Invite a friend." ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "join" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "class" "guides-card guides-step guides-card--complete") ]
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "Copy or download this small text plan." ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "a", Selector.containing [ Selector.text "Download text" ] ]
                                |> Query.has [ Selector.attribute (Attr.attribute "download" "onyx-first-room-plan.txt") ]
                        , \_ ->
                            query { blank | route = Route.Guides }
                                |> Query.has [ Selector.text "Go to: Join a room" ]
                        ]
                        ()
            , test "status navigation fetches the feed with path fallback" <|
                \_ ->
                    let
                        healthyBody =
                            Encode.encode 0
                                (Encode.object
                                    [ ( "generated_at", Encode.float 1784203200 )
                                    , ( "network", Encode.string "Onyx" )
                                    , ( "node", Encode.string "eshmaki.me" )
                                    , ( "uptime_seconds", Encode.int 60 )
                                    , ( "users_online", Encode.int 2 )
                                    , ( "mesh", Encode.object [ ( "quorum", Encode.bool True ), ( "partitioned", Encode.bool False ), ( "components", Encode.int 1 ) ] )
                                    , ( "peers", Encode.list identity [] )
                                    ]
                                )

                        clocked =
                            { blank | nowMs = 1784203200000 }

                        ( entered, outEnter ) =
                            case Url.fromString "http://example.com/status/" of
                                Just url ->
                                    update (UrlChanged url) clocked

                                Nothing ->
                                    ( clocked, [] )

                        ( answered, outAnswer ) =
                            update (HttpResult { key = "network-status", ok = True, status = 200, body = healthyBody }) entered

                        ( badBody, outBad ) =
                            update (HttpResult { key = "network-status", ok = True, status = 200, body = "nope" }) entered

                        ( failed, outFail ) =
                            update (HttpResult { key = "network-status", ok = False, status = 404, body = "" }) entered

                        ( exhausted, outExhausted ) =
                            update (HttpResult { key = "network-status", ok = False, status = 404, body = "" })
                                { entered | statusPathAttempt = 2 }

                        ( wrongKey, outWrong ) =
                            update (HttpResult { key = "other", ok = True, status = 200, body = healthyBody }) entered

                        ( refetched, outRefetch ) =
                            update StatusRefetch answered
                    in
                    Expect.all
                        [ \_ -> Expect.equal Route.Status entered.route
                        , \_ -> Expect.equal True entered.statusLoading
                        , \_ ->
                            case outEnter of
                                [ HttpFetch req ] ->
                                    Expect.all
                                        [ \_ -> Expect.equal "network-status" req.key
                                        , \_ -> Expect.equal "/stats/data/status.json" req.url
                                        ]
                                        ()

                                _ ->
                                    Expect.fail "expected the first feed fetch"
                        , \_ -> Expect.equal False answered.statusLoading
                        , \_ -> Expect.equal (Just 1784203200000) answered.statusFetchedAt
                        , \_ -> Expect.equal True (answered.networkStatus /= Nothing)
                        , \_ -> Expect.equal Status.Current (statusFeedState answered)
                        , \_ -> Expect.equal Status.Loading (statusFeedState entered)
                        , \_ ->
                            case outBad of
                                [ HttpFetch req ] ->
                                    Expect.equal "/stats/status.json" req.url

                                _ ->
                                    Expect.fail "expected the second feed path"
                        , \_ ->
                            case outFail of
                                [ HttpFetch req ] ->
                                    Expect.equal "/stats/status.json" req.url

                                _ ->
                                    Expect.fail "expected fallback on HTTP failure"
                        , \_ -> Expect.equal 1 badBody.statusPathAttempt
                        , \_ -> Expect.equal True badBody.statusLoading
                        , \_ -> Expect.equal False exhausted.statusLoading
                        , \_ -> Expect.equal [] outExhausted
                        , \_ -> Expect.equal Nothing exhausted.networkStatus
                        , \_ -> Expect.equal entered wrongKey
                        , \_ -> Expect.equal [] outWrong
                        , \_ -> Expect.equal True refetched.statusLoading
                        , \_ ->
                            case outRefetch of
                                [ HttpFetch req ] ->
                                    Expect.equal "/stats/data/status.json" req.url

                                _ ->
                                    Expect.fail "expected a refetch"
                        ]
                        ()
            , test "status tick polls every thirty seconds on the route" <|
                \_ ->
                    let
                        onRoute old =
                            { blank | route = Route.Status, nowMs = 1000000, statusFetchedAt = Just old }

                        baseRoute =
                            onRoute 1000000

                        loadingRoute =
                            { baseRoute | statusLoading = True }

                        ( polled, outPolled ) =
                            update (Tick (Time.millisToPosix 1031000)) (onRoute 1000000)

                        ( fresh, outFresh ) =
                            update (Tick (Time.millisToPosix 1029000)) (onRoute 1000000)

                        ( busy, outBusy ) =
                            update (Tick (Time.millisToPosix 2000000)) loadingRoute

                        ( away, outAway ) =
                            update (Tick (Time.millisToPosix 2000000)) { blank | nowMs = 1000000 }
                    in
                    Expect.all
                        [ \_ ->
                            case outPolled of
                                [ HttpFetch _ ] ->
                                    Expect.equal True polled.statusLoading

                                _ ->
                                    Expect.fail "expected a poll fetch"
                        , \_ -> Expect.equal [] outFresh
                        , \_ -> Expect.equal [] outBusy
                        , \_ -> Expect.equal [] outAway
                        ]
                        ()
            , test "status route renders one honest sentence" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            View.view { blank | route = Route.Status }
                                |> .title
                                |> Expect.equal "Onyx status — are the rooms up?"
                        , \_ ->
                            query { blank | route = Route.Status, statusLoading = True }
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "Are the rooms up tonight?" ]
                        , \_ ->
                            query { blank | route = Route.Status, statusLoading = True }
                                |> Query.find [ Selector.id "status-observation" ]
                                |> Query.has
                                    [ Selector.attribute (Attr.attribute "data-feed-state" "loading")
                                    , Selector.text "Looking for a public report. No health claim yet."
                                    ]
                        , \_ ->
                            query { blank | route = Route.Status, statusLoading = True }
                                |> Query.find [ Selector.class "status-check__button" ]
                                |> Query.has [ Selector.text "Checking status…" ]
                        , \_ ->
                            query
                                { blank
                                    | route = Route.Status
                                    , nowMs = 1784203200000
                                    , networkStatus =
                                        Just
                                            { generatedAt = 1784203200
                                            , network = "Onyx"
                                            , node = "eshmaki.me"
                                            , uptimeSeconds = 60
                                            , usersOnline = 2
                                            , quorum = True
                                            , partitioned = False
                                            , components = 1
                                            , peers = []
                                            , peersComplete = True
                                            }
                                }
                                |> Query.find [ Selector.id "status-observation" ]
                                |> Query.has
                                    [ Selector.attribute (Attr.attribute "data-feed-state" "current")
                                    , Selector.text "The rooms are reachable tonight."
                                    ]
                        , \_ ->
                            query { blank | route = Route.Status }
                                |> Query.has [ Selector.text "Open the roadmap" ]
                        ]
                        ()
            , test "roadmap route renders the hero, legend, and cards" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Roadmap, roadmapPriority = Just "now" }
                    in
                    Expect.all
                        [ \_ ->
                            View.view { blank | route = Route.Roadmap }
                                |> .title
                                |> Expect.equal "Onyx roadmap — rooms, calls, catch-up"
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "Rooms, calls, catch-up, and a Home Screen." ]
                        , \_ ->
                            q
                                |> Query.findAll [ Selector.class "roadmap-card" ]
                                |> Query.count (Expect.equal 3)
                        , \_ ->
                            q
                                |> Query.find [ Selector.id "roadmap-now" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "data-current" "true") ]
                        , \_ ->
                            q
                                |> Query.has
                                    [ Selector.attribute (Attr.attribute "aria-current" "location")
                                    , Selector.text "Now"
                                    ]
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "No dates on the wall" ]
                        ]
                        ()
            ]
        , describe "download fold and page" <|
            [ test "entering /download fetches the staged catalog" <|
                \_ ->
                    case Url.fromString "http://example.com/download/" of
                        Just url ->
                            let
                                ( navigated, out ) =
                                    update (UrlChanged url) blank
                            in
                            Expect.all
                                [ \_ -> Expect.equal Route.Download navigated.route
                                , \_ -> Expect.equal True navigated.downloadCatalogLoading
                                , \_ ->
                                    case out of
                                        [ HttpFetch req ] ->
                                            Expect.all
                                                [ \_ -> Expect.equal "download-catalog" req.key
                                                , \_ -> Expect.equal "/downloads/v0.1.3/catalog.json" req.url
                                                ]
                                                ()

                                        _ ->
                                            Expect.fail "expected one catalog fetch"
                                ]
                                ()

                        Nothing ->
                            Expect.fail "bad test url"
            , test "a ready catalog fires sidecar fetches for available lanes only" <|
                \_ ->
                    let
                        body =
                            "{\"lanes\":[{\"lane\":\"linux\",\"present\":true},{\"lane\":\"windows\",\"present\":true},{\"lane\":\"freebsd\",\"present\":false}]}"

                        ( ready, out ) =
                            update (HttpResult { key = "download-catalog", ok = True, status = 200, body = body }) blank

                        keys =
                            List.filterMap
                                (\o ->
                                    case o of
                                        HttpFetch req ->
                                            Just req.key

                                        _ ->
                                            Nothing
                                )
                                out
                    in
                    Expect.all
                        [ \_ -> Expect.equal False ready.downloadCatalogLoading
                        , \_ -> Expect.equal [ "windows", "linux" ] ready.downloadShaPending
                        , \_ -> Expect.equal [ "download-sha256-windows", "download-sha256-linux" ] keys
                        , \_ -> Expect.equal (Just Download.DlAvailable) (Just (downloadAvailabilityFor ready "linux"))
                        , \_ -> Expect.equal (Just Download.DlUnavailable) (Just (downloadAvailabilityFor ready "freebsd"))
                        ]
                        ()
            , test "sidecar results store the hash and clear pending; failures withhold" <|
                \_ ->
                    let
                        h =
                            String.repeat 32 "ab"

                        withPending =
                            { blank | downloadShaPending = [ "linux", "windows" ] }

                        ( hashed, _ ) =
                            update (HttpResult { key = "download-sha256-linux", ok = True, status = 200, body = h ++ "  linux.tar.gz\n" }) withPending

                        ( missing, _ ) =
                            update (HttpResult { key = "download-sha256-windows", ok = True, status = 200, body = "nope" }) hashed

                        ( failed, _ ) =
                            update (HttpResult { key = "download-sha256-linux", ok = False, status = 404, body = "" }) missing
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just h) (downloadShaFor hashed "linux")
                        , \_ -> Expect.equal [ "windows" ] hashed.downloadShaPending
                        , \_ -> Expect.equal Nothing (downloadShaFor missing "windows")
                        , \_ -> Expect.equal [] missing.downloadShaPending
                        , \_ -> Expect.equal (Just h) (downloadShaFor failed "linux")
                        ]
                        ()
            , test "a failed catalog withholds every control" <|
                \_ ->
                    let
                        ( errored, _ ) =
                            update (HttpResult { key = "download-catalog", ok = False, status = 500, body = "" }) blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal False errored.downloadCatalogLoading
                        , \_ -> Expect.equal Download.DlUnknown (downloadAvailabilityFor errored "linux")
                        , \_ ->
                            query { blank | route = Route.Download }
                                |> Query.has [ Selector.text "Artifact availability could not be confirmed. Download controls are withheld until the catalog is available." ]
                        ]
                        ()
            , test "copy requests resolve per-key text with echoed tags; forged keys stay silent" <|
                \_ ->
                    let
                        h =
                            String.repeat 32 "cd"

                        ready =
                            { blank | downloadShas = Dict.singleton "linux" h }

                        ( install, outInstall ) =
                            update (DownloadCopyRequest { key = "install-linux" }) ready

                        ( hash, outHash ) =
                            update (DownloadCopyRequest { key = "hash-linux" }) ready

                        ( missing, outMissing ) =
                            update (DownloadCopyRequest { key = "hash-windows" }) ready

                        ( bogus, outBogus ) =
                            update (DownloadCopyRequest { key = "bogus" }) ready

                        ( copied, _ ) =
                            update (ClipboardResult { tag = "dl:hash-linux", ok = True }) { ready | nowMs = 1000000 }

                        ( failedCopy, _ ) =
                            update (ClipboardResult { tag = "dl:install-linux", ok = False }) ready

                        ( reverted, _ ) =
                            update (Tick (Time.millisToPosix 1001600)) copied

                        ( early, _ ) =
                            update (Tick (Time.millisToPosix 1001599)) copied
                    in
                    Expect.all
                        [ \_ ->
                            case outInstall of
                                [ ClipboardCopy req ] ->
                                    Expect.all
                                        [ \_ -> Expect.equal "dl:install-linux" req.tag
                                        , \_ -> Expect.equal True (String.contains "install.sh" req.text)
                                        ]
                                        ()

                                _ ->
                                    Expect.fail "expected an install-steps copy"
                        , \_ ->
                            case outHash of
                                [ ClipboardCopy req ] ->
                                    Expect.all
                                        [ \_ -> Expect.equal "dl:hash-linux" req.tag
                                        , \_ -> Expect.equal h req.text
                                        ]
                                        ()

                                _ ->
                                    Expect.fail "expected a hash copy"
                        , \_ -> Expect.equal [] outMissing
                        , \_ -> Expect.equal [] outBogus
                        , \_ -> Expect.equal (DlCopyCopied 1001600) (downloadCopyState copied "hash-linux")
                        , \_ -> Expect.equal DlCopyFailed (downloadCopyState failedCopy "install-linux")
                        , \_ -> Expect.equal DlCopyIdle (downloadCopyState reverted "hash-linux")
                        , \_ -> Expect.equal (DlCopyCopied 1001600) (downloadCopyState early "hash-linux")
                        , \_ -> Expect.equal install ready
                        ]
                        ()
            , test "stats fold seeds query, fetches index plus room, and gates detail" <|
                \_ ->
                    let
                        indexBody =
                            "{\"generated_at\":1784203200,\"network\":\"Onyx\",\"node\":\"n\",\"users_online\":4,\"network_days\":[],\"channels\":[{\"channel\":\"#b\",\"messages\":5,\"present\":0,\"last_active\":100,\"topic\":\"\",\"spark\":[]},{\"channel\":\"#a\",\"messages\":9,\"present\":1,\"last_active\":200,\"topic\":\"harbor\",\"spark\":[2]}]}"

                        detailBody =
                            "{\"channel\":\"#a\",\"generated_at\":100,\"first_seen\":50,\"last_active\":90,\"present\":1,\"last_speaker\":\"\",\"totals\":{\"messages\":9,\"words\":18,\"active_users\":2,\"joins\":3,\"parts\":1,\"quits\":0,\"kicks\":0,\"topic_changes\":0},\"hours\":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],\"days\":[],\"heatmap\":[[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],\"records\":{\"busiest_day\":{\"date\":\"2026-07-08\",\"messages\":9},\"peak_hour\":9}}"

                        otherBody =
                            String.replace "\"channel\":\"#a\"" "\"channel\":\"#b\"" detailBody

                        fetchKeys out =
                            List.filterMap
                                (\o ->
                                    case o of
                                        HttpFetch req ->
                                            Just req.key

                                        _ ->
                                            Nothing
                                )
                                out
                    in
                    case Url.fromString "http://example.com/stats/?room=%23a&compare=%23a,%23b&window=7" of
                        Just url ->
                            let
                                ( navigated, outNav ) =
                                    update (UrlChanged url) blank

                                ( indexed, outIndex ) =
                                    update (HttpResult { key = "stats-index", ok = True, status = 200, body = indexBody }) { navigated | nowMs = 1784203200000 }

                                ( detailed, _ ) =
                                    update (HttpResult { key = "stats-detail-a", ok = True, status = 200, body = detailBody }) indexed

                                ( mismatched, _ ) =
                                    update (HttpResult { key = "stats-detail-a", ok = True, status = 200, body = otherBody }) indexed

                                ( failed, _ ) =
                                    update (HttpResult { key = "stats-detail-a", ok = False, status = 404, body = "" }) indexed
                            in
                            Expect.all
                                [ \_ -> Expect.equal Route.Stats navigated.route
                                , \_ -> Expect.equal "#a" navigated.statsInspected
                                , \_ -> Expect.equal [ "#a", "#b" ] navigated.statsCompare
                                , \_ -> Expect.equal 7 navigated.statsWindow
                                , \_ -> Expect.equal [ "stats-index", "stats-detail-a" ] (fetchKeys outNav)
                                , \_ -> Expect.equal Stats.FeedCurrent (statsFeedState indexed)
                                , \_ -> Expect.equal [] outIndex
                                , \_ -> Expect.equal (Just "#a") (Maybe.map .channel (statsMatchingDetail detailed))
                                , \_ -> Expect.equal Nothing (statsMatchingDetail mismatched)
                                , \_ -> Expect.equal False mismatched.statsDetailLoading
                                , \_ -> Expect.equal Nothing (statsMatchingDetail failed)
                                ]
                                ()

                        Nothing ->
                            Expect.fail "bad test url"
            , test "stats nav without a room follows the busiest channel" <|
                \_ ->
                    case Url.fromString "http://example.com/stats/" of
                        Just url ->
                            let
                                indexBody =
                                    "{\"generated_at\":1784203200,\"network_days\":[],\"channels\":[{\"channel\":\"#b\",\"messages\":5},{\"channel\":\"#a\",\"messages\":9}]}"

                                ( navigated, outNav ) =
                                    update (UrlChanged url) blank

                                ( indexed, outIndex ) =
                                    update (HttpResult { key = "stats-index", ok = True, status = 200, body = indexBody }) navigated
                            in
                            Expect.all
                                [ \_ ->
                                    Expect.equal [ "stats-index" ]
                                        (List.filterMap
                                            (\o ->
                                                case o of
                                                    HttpFetch req ->
                                                        Just req.key

                                                    _ ->
                                                        Nothing
                                            )
                                            outNav
                                        )
                                , \_ -> Expect.equal "#a" (statsInspectedChannel indexed)
                                , \_ ->
                                    case outIndex of
                                        [ HttpFetch req ] ->
                                            Expect.equal "stats-detail-a" req.key

                                        _ ->
                                            Expect.fail "expected a busiest-room detail fetch"
                                ]
                                ()

                        Nothing ->
                            Expect.fail "bad test url"
            , test "stats inspect/compare/window/share drive URL, reveal, and copy" <|
                \_ ->
                    let
                        seeded =
                            { blank | origin = "https://onyx.example", statsInspected = "#a" }

                        ( inspected, outInspect ) =
                            update (StatsInspect { channel = "#b" }) seeded

                        ( toggled, outToggle ) =
                            update (StatsToggleCompare { channel = "#a" }) seeded

                        ( untoggled, _ ) =
                            update (StatsToggleCompare { channel = "#a" }) toggled

                        full =
                            { seeded | statsCompare = [ "#a", "#b" ] }

                        ( capped, outCapped ) =
                            update (StatsToggleCompare { channel = "#c" }) full

                        ( cleared, outClear ) =
                            update StatsClearCompare full

                        ( windowed, outWindow ) =
                            update (StatsWindowSelect { window = 7 }) seeded

                        ( copying, outCopy ) =
                            update StatsCopyCompare full

                        ( copied, _ ) =
                            update (ClipboardResult { tag = "stats-compare", ok = True }) copying

                        ( staleCopy, _ ) =
                            update (ClipboardResult { tag = "stats-compare", ok = True }) full

                        replaceUrls out =
                            List.filterMap
                                (\o ->
                                    case o of
                                        HistoryReplace req ->
                                            Just req.url

                                        _ ->
                                            Nothing
                                )
                                out
                    in
                    Expect.all
                        [ \_ -> Expect.equal "#b" inspected.statsInspected
                        , \_ ->
                            Expect.equal True
                                (List.any
                                    (\o ->
                                        case o of
                                            StatsRevealInspector ->
                                                True

                                            _ ->
                                                False
                                    )
                                    outInspect
                                )
                        , \_ -> Expect.equal [ "/stats/?room=%23b" ] (replaceUrls outInspect)
                        , \_ -> Expect.equal [ "#a" ] toggled.statsCompare
                        , \_ -> Expect.equal [ "/stats/?room=%23a&compare=%23a" ] (replaceUrls outToggle)
                        , \_ -> Expect.equal [] untoggled.statsCompare
                        , \_ -> Expect.equal [ "#a", "#b" ] capped.statsCompare
                        , \_ -> Expect.equal [] outCapped
                        , \_ -> Expect.equal [] cleared.statsCompare
                        , \_ -> Expect.equal [ "/stats/?room=%23a" ] (replaceUrls outClear)
                        , \_ -> Expect.equal 7 windowed.statsWindow
                        , \_ -> Expect.equal [ "/stats/?room=%23a&window=7" ] (replaceUrls outWindow)
                        , \_ ->
                            case outCopy of
                                [ ClipboardCopy req ] ->
                                    Expect.all
                                        [ \_ -> Expect.equal "stats-compare" req.tag
                                        , \_ -> Expect.equal "https://onyx.example/stats/?room=%23a&compare=%23a,%23b" req.text
                                        ]
                                        ()

                                _ ->
                                    Expect.fail "expected a comparison copy"
                        , \_ -> Expect.equal StatsShareCopied copied.statsShare
                        , \_ -> Expect.equal StatsShareIdle staleCopy.statsShare
                        , \_ -> Expect.equal [] (replaceUrls outCopy)
                        ]
                        ()
            , test "stats poll refetches stale exports and renders the route" <|
                \_ ->
                    let
                        indexBody =
                            "{\"generated_at\":1784203200,\"network_days\":[],\"channels\":[{\"channel\":\"#a\",\"messages\":9,\"present\":1,\"last_active\":1784203100,\"topic\":\"\",\"spark\":[]}]}"

                        onRoute oldMs nowMs =
                            { blank | route = Route.Stats, nowMs = nowMs, statsFetchedAt = Just oldMs, statsLoading = False, statsDetailRequested = "#a" }

                        ( polled, outPoll ) =
                            update (Tick (Time.millisToPosix 1784233200000)) (onRoute 1784203200000 1784233200000)

                        ( fresh, outFresh ) =
                            update (Tick (Time.millisToPosix 1784203210000)) (onRoute 1784203200000 1784203210000)

                        ( indexed, _ ) =
                            update (HttpResult { key = "stats-index", ok = True, status = 200, body = indexBody }) { blank | nowMs = 1784203200000 }

                        q =
                            query { indexed | route = Route.Stats, nowMs = 1784203200000 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 2 (List.length outPoll)
                        , \_ -> Expect.equal [] outFresh
                        , \_ ->
                            View.view { blank | route = Route.Stats }
                                |> .title
                                |> Expect.equal "Onyx stats — live room activity"
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "The rooms " ]
                        , \_ ->
                            q
                                |> Query.findAll [ Selector.class "data-room-row" ]
                                |> Query.count (Expect.equal 1)
                        , \_ ->
                            q
                                |> Query.find [ Selector.id Stats.inspectorId ]
                                |> Query.has [ Selector.text "Loading #a insights…" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "public-room-comparison") ]
                                |> Query.has [ Selector.text "Put two rooms side by side." ]
                        , \_ ->
                            query { blank | route = Route.Stats }
                                |> Query.find [ Selector.id Stats.inspectorId ]
                                |> Query.has [ Selector.text "Choose a room" ]
                        ]
                        ()
            , test "download route renders lanes, macos, and the install kicker" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Download }

                        installQ =
                            case Url.fromString "http://example.com/install" of
                                Just url ->
                                    query (Tuple.first (update (UrlChanged url) blank))

                                Nothing ->
                                    q
                    in
                    Expect.all
                        [ \_ ->
                            View.view { blank | route = Route.Download }
                                |> .title
                                |> Expect.equal "Get Onyx on this device — browser first"
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "Get Onyx on this device" ]
                        , \_ ->
                            q
                                |> Query.findAll [ Selector.class "dl-artifact" ]
                                |> Query.count (Expect.equal 5)
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "dl-card-macos") ]
                                |> Query.has [ Selector.text "Coming soon" ]
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "This device" ]
                        , \_ ->
                            installQ
                                |> Query.has [ Selector.text "Same page as Download" ]
                        ]
                        ()
            , test "appearance route renders looks, radios, switches, and the staged shelf" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Appearance }

                        staged =
                            Tuple.first (update (AppearanceStageBackground { id = "deep-current" }) blank)

                        qs =
                            query { staged | route = Route.Appearance }
                    in
                    Expect.all
                        [ \_ ->
                            View.view { blank | route = Route.Appearance }
                                |> .title
                                |> Expect.equal "Appearance — Onyx"
                        , \_ ->
                            q
                                |> Query.find [ Selector.tag "h1" ]
                                |> Query.has [ Selector.text "Appearance" ]
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "Choose a look, text size, and motion. Changes apply on this device." ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Look") ]
                                |> Query.has [ Selector.text "Ocean · Dark" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Text size") ]
                                |> Query.has [ Selector.text "Medium" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Density") ]
                                |> Query.has [ Selector.text "Cozy" ]
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "Reduce motion" ]
                        , \_ ->
                            q
                                |> Query.has [ Selector.text "Use less data" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "appearance-advanced") ]
                                |> Query.has [ Selector.text "Background" ]
                        , \_ ->
                            q
                                |> Query.find [ Selector.class "background-picker" ]
                                |> Query.find [ Selector.attribute (Attr.attribute "data-background-id" "deep-current") ]
                                |> Query.has [ Selector.text "Deep Current" ]
                        , \_ ->
                            qs
                                |> Query.has [ Selector.text "Preview only" ]
                        , \_ ->
                            qs
                                |> Query.find [ Selector.attribute (Attr.attribute "data-background-canvas" "true") ]
                                |> Query.has [ Selector.attribute (Attr.attribute "data-background-id" "deep-current") ]
                        ]
                        ()
            , test "appearance chips and background cards fire their folds" <|
                \_ ->
                    let
                        q =
                            query { blank | route = Route.Appearance }
                    in
                    Expect.all
                        [ \_ ->
                            q
                                |> Query.findAll
                                    [ Selector.tag "button"
                                    , Selector.containing [ Selector.text "Ocean · Tide" ]
                                    ]
                                |> Query.first
                                |> Event.simulate Event.click
                                |> Event.expect (AppearanceSetTheme { id = "tide" })
                        , \_ ->
                            q
                                |> Query.find
                                    [ Selector.tag "button"
                                    , Selector.containing [ Selector.text "Large" ]
                                    ]
                                |> Event.simulate Event.click
                                |> Event.expect (AppearanceSetPref { key = "fontScale", value = "lg" })
                        , \_ ->
                            q
                                |> Query.find
                                    [ Selector.tag "button"
                                    , Selector.containing [ Selector.text "Reduce motion" ]
                                    ]
                                |> Event.simulate Event.click
                                |> Event.expect AppearanceToggleReduceMotion
                        , \_ ->
                            q
                                |> Query.find [ Selector.class "background-picker" ]
                                |> Query.find [ Selector.attribute (Attr.attribute "data-background-id" "deep-current") ]
                                |> Event.simulate Event.click
                                |> Event.expect (AppearanceStageBackground { id = "deep-current" })
                        , \_ ->
                            q
                                |> Query.find
                                    [ Selector.tag "button"
                                    , Selector.containing [ Selector.text "Apply background" ]
                                    ]
                                |> Event.simulate Event.click
                                |> Event.expect AppearanceApplyBackground
                        ]
                        ()
            ]
        , describe "account panel"
            [ test "closed panel renders nothing" <|
                \_ ->
                    query blank
                        |> Query.hasNot [ Selector.attribute (Attr.attribute "data-testid" "account-panel") ]
            , test "open panel shows overview devices and session sections" <|
                \_ ->
                    let
                        q =
                            query { blank | accountName = Just "kai", ourNick = "kai", accountOpen = True }
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-panel") ] q
                                |> Query.has [ Selector.text "Account settings" ]
                        , \_ ->
                            Query.has
                                [ Selector.text "Overview"
                                , Selector.text "Devices"
                                , Selector.text "Session"
                                , Selector.text "Capabilities"
                                ]
                                q
                        , \_ ->
                            query { blank | accountName = Just "kai", ourNick = "kai", accountOpen = True, connection = Live, caps = [ "message-tags", "server-time" ], capAvailable = [ "message-tags", "server-time", "sasl" ] }
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "capability-matrix-list") ]
                                |> Query.has
                                    [ Selector.text "Message tags"
                                    , Selector.text "active"
                                    ]
                        , \_ ->
                            query { blank | accountName = Just "kai", ourNick = "kai", accountOpen = True, connection = Offline }
                                |> Query.has [ Selector.text "Connect to see what this browser connection supports." ]
                        , \_ ->
                            query { blank | accountName = Just "kai", ourNick = "kai", accountOpen = True, retentionStatus = Just "Applying local history limit…" }
                                |> Query.find [ Selector.id "acct-history-title" ]
                                |> Query.has
                                    [ Selector.text "On-device history"
                                    , Selector.text "Messages per conversation"
                                    , Selector.text "Maximum local age"
                                    , Selector.text "1,000"
                                    , Selector.text "Any age"
                                    , Selector.text "Applying local history limit…"
                                    ]
                        , \_ ->
                            Query.has [ Selector.text "kai" ] q
                        ]
                        ()
            , test "guest open shows the sign-in prompt" <|
                \_ ->
                    query { blank | accountOpen = True }
                        |> Query.has [ Selector.text "Sign in to manage your account." ]
            , test "panel buttons send their messages" <|
                \_ ->
                    let
                        q =
                            query { blank | accountName = Just "kai", ourNick = "kai", accountOpen = True }
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-sessions-refresh") ] q
                                |> Event.simulate Event.click
                                |> Event.expect SessionListRequested
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-logout") ] q
                                |> Event.simulate Event.click
                                |> Event.expect SessionLogoutRequested
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-close") ] q
                                |> Event.simulate Event.click
                                |> Event.expect (SetAccountOpen False)
                        ]
                        ()
            , test "security section offers enroll when unknown" <|
                \_ ->
                    let
                        q =
                            query { blank | accountName = Just "kai", ourNick = "kai", accountOpen = True }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Two-factor authentication", Selector.text "Checking status…" ] q
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-totp-enroll") ] q
                                |> Event.simulate Event.click
                                |> Event.expect TotpEnrollRequested
                        ]
                        ()
            , test "pending shows secret copy and confirm form" <|
                \_ ->
                    let
                        q =
                            query
                                { blank
                                    | accountName = Just "kai"
                                    , ourNick = "kai"
                                    , accountOpen = True
                                    , totp = { blankTotp | status = TotpPending, secret = Just "ABC", otpauth = Just "otpauth://x" }
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Enrollment pending — confirm with a code to activate." ] q
                        , \_ ->
                            Query.has [ Selector.text "ABC" ] q
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-totp-copy-secret") ] q
                                |> Event.simulate Event.click
                                |> Event.expect TotpSecretCopyRequested
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-totp-copy-otpauth") ] q
                                |> Event.simulate Event.click
                                |> Event.expect TotpOtpauthCopyRequested
                        , \_ ->
                            Query.has [ Selector.attribute (Attr.attribute "data-testid" "account-totp-confirm") ] q
                        ]
                        ()
            , test "active offers disable and errors alert" <|
                \_ ->
                    let
                        q =
                            query
                                { blank
                                    | accountName = Just "kai"
                                    , ourNick = "kai"
                                    , accountOpen = True
                                    , totp = { blankTotp | status = TotpActive, error = Just "bad code" }
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Two-factor is active on this account." ] q
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-totp-disable") ] q
                                |> Event.simulate Event.click
                                |> Event.expect TotpDisableRequested
                        , \_ ->
                            Query.has [ Selector.text "bad code" ] q
                        ]
                        ()
            , test "cert and transparency sections bind refresh and list notices" <|
                \_ ->
                    let
                        q =
                            query
                                { blank
                                    | accountName = Just "kai"
                                    , ourNick = "kai"
                                    , accountOpen = True
                                    , serviceLog = [ "Account: KEYTRANS root abc", "Account: CERTLIST 2 fingerprints" ]
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Certificates", Selector.text "Transparency" ] q
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-cert-bind") ] q
                                |> Event.simulate Event.click
                                |> Event.expect CertBindRequested
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-keytrans-refresh") ] q
                                |> Event.simulate Event.click
                                |> Event.expect KeytransStatusRequested
                        , \_ ->
                            Query.has [ Selector.text "Account: CERTLIST 2 fingerprints", Selector.text "Account: KEYTRANS root abc" ] q
                        ]
                        ()
            , test "recovery section arms generate and dismisses fresh codes" <|
                \_ ->
                    let
                        armed =
                            query
                                { blank
                                    | accountName = Just "kai"
                                    , ourNick = "kai"
                                    , accountOpen = True
                                    , recoveryCodes = { blankRecoveryCodes | remaining = Just 3, freshCodes = [ "AAAA-1111" ] }
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Recovery codes", Selector.text "3 unused recovery codes remaining." ] armed
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "recovery-generate") ] armed
                                |> Event.simulate Event.click
                                |> Event.expect RecoveryCodesGenerateRequested
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "recovery-refresh") ] armed
                                |> Event.simulate Event.click
                                |> Event.expect RecoveryCodesStatusRequested
                        , \_ ->
                            Query.has [ Selector.text "1. AAAA-1111" ] armed
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "recovery-dismiss-fresh") ] armed
                                |> Event.simulate Event.click
                                |> Event.expect RecoveryCodesDismissFresh
                        ]
                        ()
            , test "passkeys show manager rows with rename and remove" <|
                \_ ->
                    let
                        base =
                            blank.passkey

                        q =
                            query
                                { blank
                                    | accountName = Just "kai"
                                    , ourNick = "kai"
                                    , accountOpen = True
                                    , passkeyBrowserSupported = Just True
                                    , passkey =
                                        { base
                                            | supported = Just True
                                            , creds =
                                                [ { id = "c1", label = "laptop", signCount = 3, createdAt = Nothing } ]
                                        }
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Passkeys", Selector.text "laptop" ] q
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "aria-label" "Rename laptop") ] q
                                |> Event.simulate Event.click
                                |> Event.expect (PasskeyRenameStarted { id = "c1", label = "laptop" })
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "aria-label" "Remove laptop") ] q
                                |> Event.simulate Event.click
                                |> Event.expect (PasskeyRemoveArmed "c1")
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-passkey-refresh") ] q
                                |> Event.simulate Event.click
                                |> Event.expect PasskeyListRequested
                        ]
                        ()
            , test "passkeys browser-unsupported stays inert" <|
                \_ ->
                    query
                        { blank
                            | accountName = Just "kai"
                            , ourNick = "kai"
                            , accountOpen = True
                            , passkeyBrowserSupported = Just False
                        }
                        |> Query.has [ Selector.attribute (Attr.attribute "data-testid" "passkeys-browser-unsupported") ]
            , test "device keys section publishes lists and removes" <|
                \_ ->
                    let
                        q =
                            query { blank | accountName = Just "kai", ourNick = "kai", accountOpen = True }

                        busy =
                            query
                                { blank
                                    | accountName = Just "kai"
                                    , ourNick = "kai"
                                    , accountOpen = True
                                    , e2eePublishBusy = True
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Device encryption keys" ] q
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-device-publish") ] q
                                |> Event.simulate Event.click
                                |> Event.expect E2eeKeyPublishRequested
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-device-list") ] q
                                |> Event.simulate Event.click
                                |> Event.expect E2eeKeyListRequested
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-device-remove-legacy") ] q
                                |> Event.simulate Event.click
                                |> Event.expect E2eeKeyDeleteLegacyRequested
                        , \_ ->
                            Query.has [ Selector.text "Publishing…" ] busy
                        ]
                        ()
            , test "personas section wears takes off and claims" <|
                \_ ->
                    let
                        q =
                            query
                                { blank
                                    | accountName = Just "kai"
                                    , ourNick = "kai"
                                    , accountOpen = True
                                    , personas = [ { name = "star", host = "night.example", source = "grant" } ]
                                    , personaOffers = [ { template = "poets.society/*", label = "poets" } ]
                                    , personaClaimHost = "poets.society/you"
                                }

                        empty =
                            query { blank | accountName = Just "kai", ourNick = "kai", accountOpen = True }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Personas" ] q
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-persona-wear-star") ] q
                                |> Event.simulate Event.click
                                |> Event.expect (VhostUseRequested "star")
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-persona-off") ] q
                                |> Event.simulate Event.click
                                |> Event.expect VhostOffRequested
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-persona-claim-form") ] q
                                |> Event.simulate Event.submit
                                |> Event.expect VhostClaimRequested
                        , \_ ->
                            Query.has [ Selector.text "No personas yet — claim one below, or ask staff for a grant." ] empty
                        ]
                        ()
            , test "email password and data sections send their messages" <|
                \_ ->
                    let
                        q =
                            query
                                { blank
                                    | accountName = Just "kai"
                                    , ourNick = "kai"
                                    , accountOpen = True
                                    , dropArmed = True
                                    , dropConfirm = "kai"
                                    , dropPassword = "pw"
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.has [ Selector.text "Email", Selector.text "Password", Selector.text "Delete account" ] q
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-download-store") ] q
                                |> Event.simulate Event.click
                                |> Event.expect DownloadAccountRecord
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-save-device-history") ] q
                                |> Event.simulate Event.click
                                |> Event.expect DownloadDeviceHistory
                        , \_ ->
                            Query.has [ Selector.attribute (Attr.attribute "data-testid" "account-drop-confirm") ] q
                        ]
                        ()
            ]
        , describe "push toggle"
            [ test "session section offers the opt-in toggle" <|
                \_ ->
                    let
                        q =
                            query { blank | accountOpen = True, accountName = Just "kai" }
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-push-toggle") ] q
                                |> Query.has [ Selector.text "Turn on push" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-push-toggle") ] q
                                |> Event.simulate Event.click
                                |> Event.expect WebPushToggle
                        ]
                        ()
            , test "opted-in toggle offers turn-off" <|
                \_ ->
                    query { blank | accountOpen = True, accountName = Just "kai", webPushOn = True }
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-push-toggle") ]
                        |> Query.has [ Selector.text "Turn off push" ]
            , test "busy toggle is disabled" <|
                \_ ->
                    query { blank | accountOpen = True, accountName = Just "kai", webPushBusy = True }
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-push-toggle") ]
                        |> Query.has [ Selector.disabled True ]
            , test "status line surfaces the latched error" <|
                \_ ->
                    query { blank | accountOpen = True, accountName = Just "kai", webPushError = Just "denied" }
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "account-push-status") ]
                        |> Query.has [ Selector.text "denied" ]
            ]
        , describe "room webhooks"
            [ test "management view offers create, list, and delete" <|
                \_ ->
                    let
                        q =
                            query stewardModel
                    in
                    Expect.all
                        [ \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-webhook-name") ] q
                                |> Query.has [ Selector.attribute (Attr.value "ci") ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-webhook-create") ] q
                                |> Query.has [ Selector.text "Create webhook" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-webhook-list") ] q
                                |> Query.has [ Selector.text "List webhooks" ]
                        , \_ ->
                            Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-webhook-delete") ] q
                                |> Query.has [ Selector.text "Delete webhook", Selector.disabled True ]
                        ]
                        ()
            , test "create click sends the owner verb for the room" <|
                \_ ->
                    query stewardModel
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-webhook-create") ]
                        |> Event.simulate Event.click
                        |> Event.expect (WebhookCreate "#harbor")
            , test "recent webhook notices render newest first" <|
                \_ ->
                    let
                        q =
                            query
                                { stewardModel
                                    | serviceLog =
                                        [ "Webhook: second"
                                        , "Account: other"
                                        , "Webhook: first"
                                        ]
                                }
                    in
                    Expect.all
                        [ \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "steward-webhook-notice") ] q
                                |> Query.count (Expect.equal 2)
                        , \_ ->
                            Query.findAll [ Selector.attribute (Attr.attribute "data-testid" "steward-webhook-notice") ] q
                                |> Query.first
                                |> Query.has [ Selector.text "Webhook: second" ]
                        ]
                        ()
            , test "non-owners see the hosts-managed hint" <|
                \_ ->
                    query { stewardModel | ourNick = "drew" }
                        |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "steward-webhook-readonly") ]
                        |> Query.has [ Selector.text "Managed by room hosts." ]
            ]
        ]
