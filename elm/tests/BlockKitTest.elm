module BlockKitTest exposing (suite)

{-| v3/gap-import — BlockKit-lite strict decoder, safe controls and the
origin-scoped review (oracle `integrations/blockKitLite.test.ts`,
`MessageText.blockkit.test.tsx`, `BlockKitActionConfirmation.test.tsx`),
with the hostile payloads the strict decoder must turn back into plain
text.
-}

import BlockKit exposing (ActionKind(..), BlockType(..), ButtonKind(..))
import Expect
import Json.Encode as E
import Test exposing (Test, describe, test)


line : E.Value -> String
line value =
    BlockKit.marker ++ " " ++ E.encode 0 value


parsed : E.Value -> Maybe BlockKit.Block
parsed value =
    BlockKit.parse (E.encode 0 value)


rejects : String -> E.Value -> Test
rejects name value =
    test ("rejects " ++ name) <|
        \_ -> Expect.equal Nothing (parsed value)


sendAction : String -> String -> E.Value
sendAction target value =
    E.object [ ( "type", E.string "send" ), ( "target", E.string target ), ( "value", E.string value ) ]


suite : Test
suite =
    describe "BlockKit"
        [ describe "extract"
            [ test "pulls valid blocks out and leaves readable text" <|
                \_ ->
                    let
                        result =
                            BlockKit.extract
                                ("Deploy update\n"
                                    ++ line (E.object [ ( "title", E.string "Review" ), ( "buttons", E.list identity [ E.object [ ( "label", E.string "Open" ), ( "url", E.string "https://example.test/build" ) ] ] ) ])
                                )
                    in
                    Expect.equal
                        ( result.text, List.map .title result.blocks, List.map (.buttons >> List.map .kind) result.blocks )
                        ( "Deploy update", [ Just "Review" ], [ [ OpenUrl { href = "https://example.test/build", host = "example.test" } ] ] )
            , test "malformed lines stay verbatim; later valid blocks still parse" <|
                \_ ->
                    let
                        result =
                            BlockKit.extract
                                (String.join "\n"
                                    [ "Incident"
                                    , "[onyx:block] {\"title\":\"unterminated\""
                                    , line (E.object [ ( "type", E.string "message" ), ( "text", E.string "next block" ) ])
                                    , "[onyx:block] true"
                                    , "Tail"
                                    ]
                                )
                    in
                    Expect.equal ( result.text, List.map .text result.blocks )
                        ( "Incident\n[onyx:block] {\"title\":\"unterminated\"\n[onyx:block] true\nTail", [ Just "next block" ] )
            , test "a body without the marker is untouched" <|
                \_ -> Expect.equal (BlockKit.extract "plain [onyx] text") { text = "plain [onyx] text", blocks = [] }
            , test "at most four blocks per message" <|
                \_ ->
                    let
                        one =
                            line (E.object [ ( "text", E.string "x" ) ])
                    in
                    Expect.equal (List.length (BlockKit.extract (String.join "\n" (List.repeat 6 one))).blocks) 4
            , test "CRLF bodies split cleanly" <|
                \_ ->
                    Expect.equal (BlockKit.extract ("a\u{000D}\n" ++ line (E.object [ ( "text", E.string "t" ) ]))).text "a"
            ]
        , describe "strict decoder"
            [ test "a full message block decodes" <|
                \_ ->
                    let
                        block =
                            parsed
                                (E.object
                                    [ ( "title", E.string "  Deploy  " )
                                    , ( "text", E.string "Build 42 is ready" )
                                    , ( "fields", E.list identity [ E.object [ ( "label", E.string "Branch" ), ( "value", E.string "main" ) ], E.object [ ( "label", E.string "Owner" ) ] ] )
                                    , ( "selects"
                                      , E.list identity
                                            [ E.object
                                                [ ( "label", E.string "Rate" )
                                                , ( "options", E.list identity [ E.object [ ( "label", E.string "Good" ), ( "value", E.string "good" ) ], E.object [ ( "label", E.string "Bad" ) ] ] )
                                                , ( "action", E.object [ ( "type", E.string "select-notify" ), ( "target", E.string "#ops" ), ( "value", E.string "rating" ) ] )
                                                ]
                                            ]
                                      )
                                    , ( "buttons"
                                      , E.list identity
                                            [ E.object [ ( "label", E.string "Copy id" ), ( "value", E.string "build-42" ) ]
                                            , E.object [ ( "label", E.string "Ack" ), ( "action", sendAction "#ops" "ack" ) ]
                                            ]
                                      )
                                    ]
                                )
                    in
                    Expect.equal
                        (Maybe.map (\b -> ( ( b.kind, b.title, b.text ), b.fields, ( List.map .options b.selects, List.map .kind b.buttons ) )) block)
                        (Just
                            ( ( MessageBlock, Just "Deploy", Just "Build 42 is ready" )
                            , [ { label = "Branch", value = "main" }, { label = "Owner", value = "" } ]
                            , ( [ [ { label = "Good", value = "good" }, { label = "Bad", value = "Bad" } ] ]
                              , [ CopyValue "build-42", RunAction { kind = SendAction, target = "#ops", value = Just "ack" } ]
                              )
                            )
                        )
            , test "modal blocks get a trigger label and a title" <|
                \_ ->
                    Expect.equal
                        (Maybe.map (\b -> ( b.kind, b.title )) (parsed (E.object [ ( "type", E.string "modal" ), ( "text", E.string "details" ) ])))
                        (Just ( ModalBlock "Open details", Just "Details" ))
            , test "trigger_label is honoured" <|
                \_ ->
                    Expect.equal
                        (Maybe.map .kind (parsed (E.object [ ( "type", E.string "modal" ), ( "title", E.string "Run" ), ( "trigger_label", E.string "See run" ) ])))
                        (Just (ModalBlock "See run"))
            , rejects "an empty object" (E.object [])
            , rejects "non-objects" (E.list E.int [ 1, 2 ])
            , rejects "an unknown block type" (E.object [ ( "type", E.string "section" ), ( "title", E.string "x" ) ])
            , rejects "a non-string title" (E.object [ ( "title", E.int 3 ) ])
            , rejects "an over-long title (never truncated)" (E.object [ ( "title", E.string (String.repeat 121 "a") ) ])
            , rejects "an over-long text" (E.object [ ( "text", E.string (String.repeat 601 "a") ) ])
            , rejects "a CTCP SOH in the title" (E.object [ ( "title", E.string "hi\u{0001}EDIT x\u{0001}" ) ])
            , rejects "a CR/LF in the text" (E.object [ ( "text", E.string "a\u{000D}\nPRIVMSG #x :pwn" ) ])
            , rejects "a bidi override in a label" (E.object [ ( "fields", E.list identity [ E.object [ ( "label", E.string "safe\u{202E}evil" ) ] ] ) ])
            , rejects "a zero-width space in a field value" (E.object [ ( "fields", E.list identity [ E.object [ ( "label", E.string "k" ), ( "value", E.string "a\u{200B}b" ) ] ] ) ])
            , rejects "a tag character" (E.object [ ( "text", E.string "x\u{E0041}" ) ])
            , rejects "too many buttons" (E.object [ ( "buttons", E.list identity (List.repeat 5 (E.object [ ( "label", E.string "c" ), ( "value", E.string "v" ) ])) ) ])
            , rejects "too many fields" (E.object [ ( "fields", E.list identity (List.repeat 7 (E.object [ ( "label", E.string "f" ) ])) ) ])
            , rejects "too many options" (E.object [ ( "selects", E.list identity [ E.object [ ( "label", E.string "s" ), ( "options", E.list identity (List.repeat 9 (E.object [ ( "label", E.string "o" ) ])) ), ( "action", E.object [ ( "type", E.string "select-notify" ), ( "target", E.string "#a" ) ] ) ] ] ) ])
            , rejects "a select without an action" (E.object [ ( "selects", E.list identity [ E.object [ ( "label", E.string "s" ), ( "options", E.list identity [ E.object [ ( "label", E.string "o" ) ] ] ) ] ] ) ])
            , rejects "a select with no options" (E.object [ ( "selects", E.list identity [ E.object [ ( "label", E.string "s" ), ( "options", E.list identity [] ), ( "action", E.object [ ( "type", E.string "select-notify" ), ( "target", E.string "#a" ) ] ) ] ] ) ])
            , rejects "a javascript: link" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "Run" ), ( "url", E.string "javascript:alert(1)" ) ] ] ) ])
            , rejects "a data: link" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "Run" ), ( "url", E.string "data:text/html,<script>" ) ] ] ) ])
            , rejects "a credentialed link" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "Bank" ), ( "url", E.string "https://bank.example@evil.test/login" ) ] ] ) ])
            , rejects "a non-ASCII (homograph) host" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "Pay" ), ( "url", E.string "https://аpple.example/" ) ] ] ) ])
            , rejects "an over-long URL (never truncated)" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "L" ), ( "url", E.string ("https://example.test/" ++ String.repeat 500 "a") ) ] ] ) ])
            , rejects "a button that does two things" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "x" ), ( "url", E.string "https://example.test" ), ( "value", E.string "v" ) ] ] ) ])
            , rejects "a button that does nothing" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "x" ) ] ] ) ])
            , rejects "an unknown action type" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "x" ), ( "action", E.object [ ( "type", E.string "open-url" ), ( "target", E.string "#a" ), ( "value", E.string "v" ) ] ) ] ] ) ])
            , rejects "a slash-command action value" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "x" ), ( "action", sendAction "#a" "/quit bye" ) ] ] ) ])
            , rejects "a send action without a value" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "x" ), ( "action", E.object [ ( "type", E.string "send" ), ( "target", E.string "#a" ) ] ) ] ] ) ])
            , rejects "a multi-target action" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "x" ), ( "action", sendAction "#a,#b" "hi" ) ] ] ) ])
            , rejects "an over-long copy value (never truncated)" (E.object [ ( "buttons", E.list identity [ E.object [ ( "label", E.string "Copy" ), ( "value", E.string (String.repeat 513 "k") ) ] ] ) ])
            , rejects "an object with too many keys" (E.object (List.map (\i -> ( "k" ++ String.fromInt i, E.int i )) (List.range 1 17)))
            , test "rejects a payload over 4 KiB" <|
                \_ -> Expect.equal Nothing (BlockKit.parse ("{\"text\":\"x\",\"pad\":\"" ++ String.repeat 4100 "a" ++ "\"}"))
            , test "unknown extra keys are ignored" <|
                \_ -> Expect.notEqual Nothing (parsed (E.object [ ( "text", E.string "t" ), ( "version", E.int 2 ) ]))
            , test "null optional fields count as absent" <|
                \_ -> Expect.notEqual Nothing (parsed (E.object [ ( "text", E.string "t" ), ( "title", E.null ), ( "buttons", E.null ) ]))
            ]
        , describe "safe links"
            [ test "http(s) only, host shown, punycode kept as punycode" <|
                \_ ->
                    Expect.equal
                        [ BlockKit.safeUrl "https://Example.TEST/a?b=1#c", BlockKit.safeUrl "http://xn--pple-43d.example/", BlockKit.safeUrl "ftp://example.test" ]
                        [ Just { href = "https://Example.TEST/a?b=1#c", host = "example.test" }, Just { href = "http://xn--pple-43d.example/", host = "xn--pple-43d.example" }, Nothing ]
            , test "spaces and backslashes are refused" <|
                \_ -> Expect.equal [ BlockKit.safeUrl "https://a.test/x y", BlockKit.safeUrl "https://a.test\\@evil.test" ] [ Nothing, Nothing ]
            ]
        , describe "origin-scoped actions"
            [ test "an action for this conversation prepares the exact request" <|
                \_ ->
                    Expect.equal
                        (BlockKit.prepare "#ops" { kind = SendAction, target = "#ops", value = Just "ack" } Nothing)
                        (Just { target = "#ops", text = "ack" })
            , test "channel case does not matter, the origin is what is sent to" <|
                \_ ->
                    Expect.equal
                        (BlockKit.prepare "#ops" { kind = SendAction, target = "#OPS", value = Just "ack" } Nothing)
                        (Just { target = "#ops", text = "ack" })
            , test "an action aimed at another conversation never prepares" <|
                \_ -> Expect.equal (BlockKit.prepare "#general" { kind = SendAction, target = "#admin", value = Just "op me" } Nothing) Nothing
            , test "a DM action may only reach the DM peer" <|
                \_ ->
                    Expect.equal
                        ( BlockKit.prepare "bob" { kind = SendAction, target = "bob", value = Just "yes" } Nothing
                        , BlockKit.prepare "bob" { kind = SendAction, target = "nickserv", value = Just "yes" } Nothing
                        )
                        ( Just { target = "bob", text = "yes" }, Nothing )
            , test "a non-canonical origin fails closed" <|
                \_ -> Expect.equal (BlockKit.prepare " #ops" { kind = SendAction, target = "#ops", value = Just "a" } Nothing) Nothing
            , test "select-notify joins prefix and choice" <|
                \_ ->
                    Expect.equal
                        ( BlockKit.prepare "#ops" { kind = SelectNotify, target = "#ops", value = Just "rating" } (Just "good")
                        , BlockKit.prepare "#ops" { kind = SelectNotify, target = "#ops", value = Nothing } (Just "good")
                        )
                        ( Just { target = "#ops", text = "rating: good" }, Just { target = "#ops", text = "good" } )
            , test "a smuggled choice (CRLF, slash, empty) never prepares" <|
                \_ ->
                    Expect.equal
                        (List.map (\v -> BlockKit.prepare "#ops" { kind = SelectNotify, target = "#ops", value = Nothing } (Just v)) [ "x\u{000D}\nQUIT", "/part", "", "a\u{0001}" ])
                        [ Nothing, Nothing, Nothing, Nothing ]
            , test "a combined value over the limit is refused, not cut" <|
                \_ ->
                    Expect.equal (BlockKit.prepare "#ops" { kind = SelectNotify, target = "#ops", value = Just (String.repeat 200 "p") } (Just (String.repeat 60 "c"))) Nothing
            ]
        , describe "state"
            [ test "staging reviews; confirm re-validates and sends exactly once, then returns focus" <|
                \_ ->
                    let
                        action =
                            { kind = SendAction, target = "#ops", value = Just "ack" }

                        ( staged, _ ) =
                            BlockKit.update 0 (BlockKit.Stage { origin = "#ops", action = action, selected = Nothing, returnTo = "bk-x" }) BlockKit.blank

                        ( done, effects ) =
                            BlockKit.update 0 BlockKit.ConfirmSend staged
                    in
                    Expect.equal ( Maybe.map (.prepared >> .text) staged.review, done.review, effects )
                        ( Just "ack", Nothing, [ BlockKit.SendText { target = "#ops", text = "ack" }, BlockKit.FocusId "bk-x" ] )
            , test "an off-origin stage opens no review" <|
                \_ ->
                    let
                        ( staged, _ ) =
                            BlockKit.update 0 (BlockKit.Stage { origin = "#general", action = { kind = SendAction, target = "#admin", value = Just "x" }, selected = Nothing, returnTo = "b" }) BlockKit.blank
                    in
                    Expect.equal staged.review Nothing
            , test "cancel sends nothing and returns focus" <|
                \_ ->
                    let
                        ( staged, _ ) =
                            BlockKit.update 0 (BlockKit.Stage { origin = "#ops", action = { kind = SendAction, target = "#ops", value = Just "ack" }, selected = Nothing, returnTo = "b" }) BlockKit.blank
                    in
                    Expect.equal (Tuple.second (BlockKit.update 0 BlockKit.Escape staged)) [ BlockKit.FocusId "b" ]
            , test "copy reports Copied, then expires" <|
                \_ ->
                    let
                        ( pending, effects ) =
                            BlockKit.update 100 (BlockKit.CopyClicked { key = "k", value = "build-42" }) BlockKit.blank

                        ( copied, _ ) =
                            BlockKit.update 100 (BlockKit.CopyResult { tag = "blockkit:k", ok = True }) pending
                    in
                    Expect.equal
                        ( effects, BlockKit.copyFor copied 200 "k", BlockKit.copyFor copied 5000 "k" )
                        ( [ BlockKit.CopyText { text = "build-42", tag = "blockkit:k" } ], Just (BlockKit.Copied 1700), Nothing )
            , test "a failed copy says so" <|
                \_ ->
                    let
                        ( pending, _ ) =
                            BlockKit.update 0 (BlockKit.CopyClicked { key = "k", value = "v" }) BlockKit.blank

                        ( failed, _ ) =
                            BlockKit.update 0 (BlockKit.CopyResult { tag = "blockkit:k", ok = False }) pending
                    in
                    Expect.equal (BlockKit.copyFor failed 10 "k") (Just (BlockKit.CopyFailed 2400))
            , test "a stray clipboard result is ignored" <|
                \_ -> Expect.equal (Tuple.first (BlockKit.update 0 (BlockKit.CopyResult { tag = "blockkit:zz", ok = True }) BlockKit.blank)) BlockKit.blank
            ]
        ]
