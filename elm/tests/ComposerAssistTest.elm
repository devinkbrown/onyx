module ComposerAssistTest exposing (suite)

{-| Composer assist (v3/composer): the oracle vectors from
`src/lib/composer/nickComplete.test.ts` and
`src/lib/commands/slash.test.ts`, plus the `Composer.tsx` list
behaviour driven through `App.update` and the rendered composer.
-}

import App exposing (..)
import ComposerAssist exposing (Intent(..), Menu(..))
import Expect
import Dict
import Html
import Html.Attributes
import Json.Encode as Encode
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


channelModel : Model
channelModel =
    blank
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":s 353 me = #c :@alice +alex albert bob")
        |> step (ChannelSelect "#c")


typed : String -> Model -> Model
typed draft model =
    step (ComposerInput draft) model


names : List { a | name : String } -> List String
names =
    List.map .name


suggest : String -> Bool -> List String
suggest draft isOper =
    names (ComposerAssist.slashSuggestions draft 8 isOper slashCommands)


command : String -> SlashCommand
command name =
    case findSlashCommand name of
        Just found ->
            found

        Nothing ->
            Debug.todo ("missing " ++ name)


menuOf : Model -> Menu { kind : SlashCommandKind, usage : String, description : String }
menuOf model =
    ComposerAssist.menuFor (composerAssistInputs model) model.composerAssist


render : Model -> Query.Single Msg
render model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


key : String -> Encode.Value
key name =
    Encode.object [ ( "key", Encode.string name ), ( "isComposing", Encode.bool False ) ]


composerInput : Model -> Query.Single Msg
composerInput model =
    render model |> Query.find [ Selector.id "shell-composer-input" ]


suite : Test
suite =
    describe "ComposerAssist"
        [ describe "nickComplete (oracle vectors)"
            [ test "extracts a bare nick token before the caret" <|
                \_ ->
                    ComposerAssist.nickTokenAt "hey al" 6
                        |> Expect.equal (Just { start = 4, end = 6, at = False, query = "al" })
            , test "extracts an @-mention token" <|
                \_ ->
                    ComposerAssist.nickTokenAt "hi @Ka" 6
                        |> Expect.equal (Just { start = 3, end = 6, at = True, query = "Ka" })
            , test "does not steal slash-command completion" <|
                \_ -> ComposerAssist.nickTokenAt "/jo" 3 |> Expect.equal Nothing
            , test "ranks prefix matches with case-sensitive preference then shorter nicks" <|
                \_ ->
                    ComposerAssist.rankNickCompletions "al" [ "alice", "AL", "bob", "Alex" ] 8
                        |> Expect.equal [ "alice", "AL", "Alex" ]
            , test "applies completion with trailing space and @" <|
                \_ ->
                    ComposerAssist.applyNickCompletion "hi @Ka" { start = 3, end = 6, at = True, query = "Ka" } "kain"
                        |> Expect.equal { text = "hi @kain ", caret = 9 }
            , test "cycles through matches on repeated Tab" <|
                \_ ->
                    let
                        nicks =
                            [ "alice", "alex", "albert" ]

                        first =
                            ComposerAssist.cycleNickCompletion "al" 2 nicks -1

                        again =
                            first |> Maybe.andThen (\f -> ComposerAssist.cycleNickCompletion "al" 2 nicks f.index)
                    in
                    Expect.equal
                        ( Maybe.map (\f -> ( List.head f.matches, f.text )) first, Maybe.map (\a -> ( a.text, a.index )) again )
                        ( Just ( Just "alex", "alex " ), Just ( "alice ", 1 ) )
            , test "a mid-word caret and a nick-char boundary refuse" <|
                \_ ->
                    Expect.equal
                        ( ComposerAssist.nickTokenAt "foo@al" 6, ComposerAssist.nickTokenAt "hey " 4 )
                        ( Nothing, Nothing )
            , test "case-insensitive duplicates collapse to the first seen" <|
                \_ ->
                    ComposerAssist.rankNickCompletions "b" [ "bob", "Bob", "BOB" ] 8
                        |> Expect.equal [ "bob" ]
            ]
        , describe "slash registry (oracle vectors)"
            [ test "extracts a command query only from leading slash input" <|
                \_ ->
                    List.map ComposerAssist.slashCommandQuery [ "/jo", "/", "hello /jo", "//not-a-command", "/join #c" ]
                        |> Expect.equal [ Just "jo", Just "", Nothing, Nothing, Nothing ]
            , test "returns typed command suggestions by name or alias" <|
                \_ ->
                    Expect.equal
                        ( suggest "/jo" False, List.member "join" (suggest "/j" False), suggest "/web" False )
                        ( [ "join" ], True, [ "webhook" ] )
            , test "completes IRC commands with a trailing argument space" <|
                \_ ->
                    Expect.equal
                        ( ComposerAssist.completeSlashCommand "/jo" (command "join")
                        , ComposerAssist.completeSlashCommand "/jo #root" (command "join")
                        )
                        ( "/join ", "/join #root" )
            , test "expands local text commands instead of preserving slash syntax" <|
                \_ ->
                    ComposerAssist.completeSlashCommand "/shr" (command "shrug")
                        |> Expect.equal "¯\\_(ツ)_/¯"
            , test "platform-local suggestions" <|
                \_ ->
                    Expect.equal
                        ( List.member "snooze" (suggest "/sno" False), suggest "/exp" False )
                        ( True, [ "export" ] )
            , test "hides operator commands from members and reveals them to opers" <|
                \_ ->
                    Expect.equal
                        [ suggest "/kil" False, suggest "/kil" True, suggest "/reh" False, suggest "/reh" True, suggest "/wall" True ]
                        [ [], [ "kill" ], [], [ "rehash" ], [ "broadcast" ] ]
            , test "leaves ordinary suggestions untouched when oper status is on" <|
                \_ -> suggest "/jo" True |> Expect.equal [ "join" ]
            , test "a bare slash lists at most eight" <|
                \_ -> List.length (suggest "/" False) |> Expect.equal 8
            ]
        , describe "App.update"
            [ test "nick candidates are the active room's roster" <|
                \_ ->
                    List.sort (composerNickCandidates channelModel)
                        |> Expect.equal [ "albert", "alex", "alice", "bob" ]
            , test "DM candidates are the peer and self" <|
                \_ ->
                    composerNickCandidates { blank | activeChannel = Just "kain", ourNick = "me" }
                        |> Expect.equal [ "kain", "me" ]
            , test "a slash draft opens the slash list; Enter accepts the highlighted row" <|
                \_ ->
                    let
                        model =
                            channelModel |> typed "/jo" |> step (ComposerAssistIntent MenuAccept)
                    in
                    Expect.equal ( model.composer, menuOf model == NoMenu ) ( "/join ", True )
            , test "arrows move and wrap the highlight" <|
                \_ ->
                    let
                        model =
                            channelModel |> typed "/un" |> step (ComposerAssistIntent (MenuMove -1))
                    in
                    case menuOf model of
                        SlashMenu commands ->
                            Expect.equal model.composerAssist.slashIndex (List.length commands - 1)

                        _ ->
                            Expect.fail "slash list closed"
            , test "Escape dismisses until the next keystroke" <|
                \_ ->
                    let
                        dismissed =
                            channelModel |> typed "/jo" |> step (ComposerAssistIntent MenuDismiss)

                        rearmed =
                            dismissed |> typed "/j"
                    in
                    Expect.equal ( menuOf dismissed == NoMenu, menuOf rearmed /= NoMenu ) ( True, True )
            , test "oper verbs appear only with oper status" <|
                \_ ->
                    let
                        member =
                            channelModel |> typed "/kil"

                        oper =
                            { channelModel | isOper = True } |> typed "/kil"
                    in
                    Expect.equal ( menuOf member == NoMenu, menuOf oper /= NoMenu ) ( True, True )
            , test "@ opens name completions; picking writes the mention" <|
                \_ ->
                    let
                        model =
                            channelModel |> typed "hi @al" |> step (ComposerAssistIntent (MenuPick 1))
                    in
                    Expect.equal ( model.composer, model.composerAssist.nickDismissed ) ( "hi @alice ", True )
            , test "Tab cycles nick completion with the list dismissed" <|
                \_ ->
                    let
                        model =
                            channelModel
                                |> typed "al"
                                |> step (ComposerAssistIntent MenuDismiss)
                                |> step (ComposerAssistIntent NickCycle)
                    in
                    model.composer |> Expect.equal "alex "
            , test "completion persists the draft for the room" <|
                \_ ->
                    let
                        model =
                            channelModel |> typed "/jo" |> step (ComposerAssistIntent MenuAccept)
                    in
                    Dict.get "#c" model.composerDrafts |> Expect.equal (Just "/join ")
            , test "emoji insert appends to the draft and closes the picker" <|
                \_ ->
                    let
                        model =
                            channelModel
                                |> typed "nice "
                                |> step ComposerEmojiToggle
                                |> step (ComposerEmojiInsert "🔥")
                    in
                    Expect.equal ( model.composer, model.composerAssist.emojiOpen ) ( "nice 🔥", False )
            , test "emoji insert without a conversation is a no-op" <|
                \_ ->
                    (step (ComposerEmojiInsert "🔥") blank).composer |> Expect.equal ""
            ]
        , describe "rendered composer"
            [ test "slash list renders usage and description rows" <|
                \_ ->
                    render (channelModel |> typed "/jo")
                        |> Query.find [ Selector.id "shell-command-menu" ]
                        |> Query.has [ Selector.attribute (attrAria "Slash command suggestions"), Selector.text "/join #room", Selector.text "Join a room." ]
            , test "the input is wired as a combobox while a list is open" <|
                \_ ->
                    composerInput (channelModel |> typed "/jo")
                        |> Query.has
                            [ Selector.attribute (attr "aria-activedescendant" "shell-command-option-0")
                            , Selector.attribute (attr "aria-expanded" "true")
                            ]
            , test "Enter with the list open accepts instead of sending" <|
                \_ ->
                    composerInput (channelModel |> typed "/jo")
                        |> Event.simulate (Event.custom "keydown" (key "Enter"))
                        |> Event.expect (ComposerAssistIntent MenuAccept)
            , test "ArrowDown with the list open moves the highlight" <|
                \_ ->
                    composerInput (channelModel |> typed "/j")
                        |> Event.simulate (Event.custom "keydown" (key "ArrowDown"))
                        |> Event.expect (ComposerAssistIntent (MenuMove 1))
            , test "Enter with no list sends (the field is a growing textarea)" <|
                \_ ->
                    composerInput (channelModel |> typed "hello")
                        |> Event.simulate (Event.custom "keydown" (key "Enter"))
                        |> Event.expect ComposerSend
            , test "Shift+Enter with no list keeps the newline" <|
                \_ ->
                    composerInput (channelModel |> typed "hello")
                        |> Event.simulate
                            (Event.custom "keydown"
                                (Encode.object
                                    [ ( "key", Encode.string "Enter" )
                                    , ( "isComposing", Encode.bool False )
                                    , ( "shiftKey", Encode.bool True )
                                    ]
                                )
                            )
                        |> Event.toResult
                        |> Expect.err
            , test "Enter mid-composition yields to the IME" <|
                \_ ->
                    composerInput (channelModel |> typed "hello")
                        |> Event.simulate
                            (Event.custom "keydown"
                                (Encode.object [ ( "key", Encode.string "Enter" ), ( "isComposing", Encode.bool True ) ])
                            )
                        |> Event.toResult
                        |> Expect.err
            , test "nick list renders with the oracle test ids" <|
                \_ ->
                    render (channelModel |> typed "@al")
                        |> Query.find [ Selector.attribute (attr "data-testid" "composer-nick-menu") ]
                        |> Query.has [ Selector.attribute (attr "data-testid" "composer-nick-option-alex"), Selector.text "Complete nick" ]
            , test "emoji button opens the picker" <|
                \_ ->
                    render channelModel
                        |> Query.find [ Selector.attribute (attrAria "Insert emoji") ]
                        |> Event.simulate Event.click
                        |> Event.expect ComposerEmojiToggle
            , test "open picker lists searchable emoji" <|
                \_ ->
                    render (channelModel |> step ComposerEmojiToggle |> step (ComposerEmojiQuery "fire"))
                        |> Query.find [ Selector.id "shell-emoji-picker" ]
                        |> Query.find [ Selector.attribute (attrAria "Insert fire") ]
                        |> Event.simulate Event.click
                        |> Event.expect (ComposerEmojiInsert "🔥")
            , test "Escape in the composer closes an open picker" <|
                \_ ->
                    composerInput (channelModel |> step ComposerEmojiToggle)
                        |> Event.simulate (Event.custom "keydown" (key "Escape"))
                        |> Event.expect ComposerEmojiClose
            , -- v3/rx-convo: a keyboard user opens the picker with Enter and
              -- is still on the toggle: Escape there closes it too.
              test "Escape on the open picker's toggle closes it" <|
                \_ ->
                    render (channelModel |> step ComposerEmojiToggle)
                        |> Query.find [ Selector.attribute (attrAria "Insert emoji") ]
                        |> Event.simulate (Event.custom "keydown" (key "Escape"))
                        |> Event.expect ComposerEmojiClose
            , test "Escape inside the picker closes it" <|
                \_ ->
                    render (channelModel |> step ComposerEmojiToggle)
                        |> Query.find [ Selector.id "shell-emoji-picker" ]
                        |> Event.simulate (Event.custom "keydown" (key "Escape"))
                        |> Event.expect ComposerEmojiClose
            , test "a closed picker's toggle ignores Escape" <|
                \_ ->
                    render channelModel
                        |> Query.find [ Selector.attribute (attrAria "Insert emoji") ]
                        |> Event.simulate (Event.custom "keydown" (key "Escape"))
                        |> Event.toResult
                        |> Expect.err
            ]
        ]


attr : String -> String -> Html.Attribute msg
attr name value =
    Html.Attributes.attribute name value


attrAria : String -> Html.Attribute msg
attrAria value =
    Html.Attributes.attribute "aria-label" value
