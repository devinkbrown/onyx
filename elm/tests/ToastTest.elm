module ToastTest exposing (suite)

{-| Vectors for the toast store core, mirroring the Zustand `toasts`
slice (`addToast` / `dismissToast`, `MAX_TOAST_ENTRIES = 20`,
`MAX_SYSTEM_EVENT_TEXT_LENGTH = 4096`, duration clamp 0..60000) and the
`primitives/Toast.tsx` renderer (default 4000ms auto-dismiss, sticky at
`duration <= 0`, danger/warning/success/info intents), plus the undo
replay through the blocklist fold (mirroring the `undoAction` closures
in `IgnoredUsersControl.tsx`).
-}

import App exposing (..)
import Expect
import Set
import Test exposing (Test, describe, test)


plain : ToastInput
plain =
    { variant = ToastInfo
    , title = "Hello"
    , description = Nothing
    , duration = Nothing
    , groupKey = Nothing
    , undo = Nothing
    }


suite : Test
suite =
    describe "toast store"
        [ describe "addToast"
            [ test "appends with a sequenced id and timestamp" <|
                \_ ->
                    let
                        added =
                            addToast plain 1000 blank
                    in
                    Expect.all
                        [ \m -> Expect.equal 1 (List.length m.toasts)
                        , \m -> Expect.equal 1 m.toastSeq
                        , \m ->
                            case m.toasts of
                                [ toast ] ->
                                    Expect.all
                                        [ \t -> Expect.equal "onyx-toast-1" t.id
                                        , \t -> Expect.equal 1000 t.addedAt
                                        , \t -> Expect.equal "Hello" t.title
                                        ]
                                        toast

                                _ ->
                                    Expect.fail "expected one toast"
                        ]
                        added
            , test "empty title drops the toast and holds the sequence" <|
                \_ ->
                    let
                        added =
                            addToast { plain | title = "" } 0 blank
                    in
                    Expect.all
                        [ \m -> Expect.equal [] m.toasts
                        , \m -> Expect.equal 0 m.toastSeq
                        ]
                        added
            , test "title is bounded at 4096 chars" <|
                \_ ->
                    let
                        added =
                            addToast { plain | title = String.repeat 5000 "x" } 0 blank
                    in
                    case added.toasts of
                        [ toast ] ->
                            Expect.equal 4096 (String.length toast.title)

                        _ ->
                            Expect.fail "expected one toast"
            , test "empty description and groupKey normalize to Nothing" <|
                \_ ->
                    let
                        added =
                            addToast { plain | description = Just "", groupKey = Just "" } 0 blank
                    in
                    case added.toasts of
                        [ toast ] ->
                            Expect.all
                                [ \t -> Expect.equal Nothing t.description
                                , \t -> Expect.equal Nothing t.groupKey
                                ]
                                toast

                        _ ->
                            Expect.fail "expected one toast"
            , test "durations clamp to 0..60000" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just 0) (clampToastDuration (Just 0))
                        , \_ -> Expect.equal (Just 4000) (clampToastDuration (Just 4000))
                        , \_ -> Expect.equal (Just 60000) (clampToastDuration (Just 60000))
                        , \_ -> Expect.equal Nothing (clampToastDuration (Just -1))
                        , \_ -> Expect.equal Nothing (clampToastDuration (Just 60001))
                        , \_ -> Expect.equal Nothing (clampToastDuration Nothing)
                        ]
                        ()
            , test "list keeps the newest 20" <|
                \_ ->
                    let
                        filled =
                            List.foldl
                                (\n model -> addToast { plain | title = "t" ++ String.fromInt n } (toFloat n) model)
                                blank
                                (List.range 1 21)
                    in
                    Expect.all
                        [ \m -> Expect.equal 20 (List.length m.toasts)
                        , \m -> Expect.equal 21 m.toastSeq
                        , \m ->
                            Expect.equal (Just "t21")
                                (m.toasts |> List.reverse |> List.head |> Maybe.map .title)
                        , \m ->
                            Expect.equal False
                                (List.any (\t -> t.title == "t1") m.toasts)
                        ]
                        filled
            ]
        , describe "dismissToast"
            [ test "removes the named toast" <|
                \_ ->
                    let
                        added =
                            addToast plain 0 blank
                                |> addToast { plain | title = "Second" } 0

                        dismissed =
                            dismissToast "onyx-toast-1" added
                    in
                    Expect.all
                        [ \m -> Expect.equal 1 (List.length m.toasts)
                        , \m ->
                            Expect.equal (Just "Second")
                                (m.toasts |> List.head |> Maybe.map .title)
                        ]
                        dismissed
            , test "unknown id is a no-op" <|
                \_ ->
                    let
                        added =
                            addToast plain 0 blank
                    in
                    Expect.equal 1 (List.length (dismissToast "onyx-toast-9" added).toasts)
            ]
        , describe "expireToasts"
            [ test "unset duration resolves to the 4000ms default" <|
                \_ ->
                    let
                        added =
                            addToast plain 0 blank
                    in
                    Expect.all
                        [ \m -> Expect.equal 1 (List.length (expireToasts 3999 m).toasts)
                        , \m -> Expect.equal 0 (List.length (expireToasts 4000 m).toasts)
                        ]
                        added
            , test "explicit duration is honored" <|
                \_ ->
                    let
                        added =
                            addToast { plain | duration = Just 10000 } 0 blank
                    in
                    Expect.all
                        [ \m -> Expect.equal 1 (List.length (expireToasts 9999 m).toasts)
                        , \m -> Expect.equal 0 (List.length (expireToasts 10000 m).toasts)
                        ]
                        added
            , test "zero duration stays sticky" <|
                \_ ->
                    let
                        added =
                            addToast { plain | duration = Just 0 } 0 blank
                    in
                    Expect.equal 1 (List.length (expireToasts 3600000 added).toasts)
            ]
        , describe "toastIntent"
            [ test "collapses eight variants onto four intents" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "danger" (toastIntent ToastError)
                        , \_ -> Expect.equal "warning" (toastIntent ToastWarning)
                        , \_ -> Expect.equal "success" (toastIntent ToastSuccess)
                        , \_ -> Expect.equal "info" (toastIntent ToastInfo)
                        , \_ -> Expect.equal "info" (toastIntent ToastMention)
                        , \_ -> Expect.equal "info" (toastIntent ToastDm)
                        , \_ -> Expect.equal "info" (toastIntent ToastJoin)
                        , \_ -> Expect.equal "info" (toastIntent ToastUndo)
                        ]
                        ()
            ]
        , describe "fireToastUndo"
            [ test "UndoIgnoreUser blocks the nick and dismisses" <|
                \_ ->
                    let
                        added =
                            addToast { plain | undo = Just (UndoIgnoreUser "Kai") } 0 blank

                        ( fired, _ ) =
                            fireToastUndo "onyx-toast-1" added
                    in
                    Expect.all
                        [ \m -> Expect.equal True (Set.member "kai" m.ignoredUsers)
                        , \m -> Expect.equal [] m.toasts
                        ]
                        fired
            , test "UndoUnignoreUser unblocks the nick and dismisses" <|
                \_ ->
                    let
                        seeded =
                            { blank | ignoredUsers = Set.singleton "kai" }

                        added =
                            addToast { plain | undo = Just (UndoUnignoreUser "Kai") } 0 seeded

                        ( fired, _ ) =
                            fireToastUndo "onyx-toast-1" added
                    in
                    Expect.all
                        [ \m -> Expect.equal False (Set.member "kai" m.ignoredUsers)
                        , \m -> Expect.equal [] m.toasts
                        ]
                        fired
            , test "a toast without undo just dismisses" <|
                \_ ->
                    let
                        added =
                            addToast plain 0 blank

                        ( fired, out ) =
                            fireToastUndo "onyx-toast-1" added
                    in
                    Expect.all
                        [ \m -> Expect.equal [] m.toasts
                        , \_ -> Expect.equal [] out
                        ]
                        fired
            , test "unknown id is a no-op" <|
                \_ ->
                    let
                        added =
                            addToast plain 0 blank

                        ( fired, _ ) =
                            fireToastUndo "onyx-toast-9" added
                    in
                    Expect.equal 1 (List.length fired.toasts)
            ]
        , describe "update arms"
            [ test "ToastDismiss drops the row" <|
                \_ ->
                    let
                        added =
                            addToast plain 0 blank

                        ( dismissed, _ ) =
                            update (ToastDismiss "onyx-toast-1") added
                    in
                    Expect.equal [] dismissed.toasts
            , test "ToastUndo replays the stored action" <|
                \_ ->
                    let
                        added =
                            addToast { plain | undo = Just (UndoIgnoreUser "kai") } 0 blank

                        ( fired, _ ) =
                            update (ToastUndoFired "onyx-toast-1") added
                    in
                    Expect.all
                        [ \m -> Expect.equal True (Set.member "kai" m.ignoredUsers)
                        , \m -> Expect.equal [] m.toasts
                        ]
                        fired
            ]
        , describe "blocked dm compose"
            [ test "send to a blocked nick refuses with error and toast" <|
                \_ ->
                    let
                        blocked =
                            { blank
                                | activeChannel = Just "kai"
                                , composer = "hello"
                                , ignoredUsers = Set.fromList [ "kai" ]
                            }

                        ( refused, outs ) =
                            update ComposerSend blocked
                    in
                    Expect.all
                        [ \m -> Expect.equal (Just "Unblock them on this device to send a message.") m.composerError
                        , \m -> Expect.equal "hello" m.composer
                        , \m -> Expect.equal [] outs
                        , \m ->
                            case m.toasts of
                                [ toast ] ->
                                    Expect.all
                                        [ \t -> Expect.equal ToastInfo t.variant
                                        , \t -> Expect.equal "You blocked kai" t.title
                                        ]
                                        toast

                                _ ->
                                    Expect.fail "expected one toast"
                        ]
                        refused
            , test "channel targets and strangers still send" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal False
                                (isBlockedDmTarget { blank | ignoredUsers = Set.fromList [ "kai" ] } "#room")
                        , \_ ->
                            Expect.equal False
                                (isBlockedDmTarget { blank | ignoredUsers = Set.fromList [ "kai" ] } "stranger")
                        , \_ ->
                            Expect.equal True
                                (isBlockedDmTarget { blank | ignoredUsers = Set.fromList [ "kai" ] } "KAI")
                        ]
                        ()
            , test "typing clears the composer error" <|
                \_ ->
                    let
                        ( typed, _ ) =
                            update (ComposerInput "hi")
                                { blank | composerError = Just "stale" }
                    in
                    Expect.equal Nothing typed.composerError
            , test "person tokens strip controls and cap" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "You blocked kai" (blockedDmComposeCopy "kai").title
                        , \_ -> Expect.equal "" (sanitizePersonToken "   " 128)
                        , \_ -> Expect.equal 128 (String.length (sanitizePersonToken (String.repeat 200 "a") 128))
                        ]
                        ()
            ]
        , describe "seal failure producers"
            [ test "room seal failure toasts the lock and logs" <|
                \_ ->
                    let
                        ( failed, _ ) =
                            update (RoomSealFailed { room = "#x", recoveryRequired = False, notProvisioned = False }) blank
                    in
                    Expect.all
                        [ \m ->
                            case m.toasts of
                                [ toast ] ->
                                    Expect.all
                                        [ \t -> Expect.equal ToastError t.variant
                                        , \t -> Expect.equal "Encrypted room is locked" t.title
                                        , \t ->
                                            Expect.equal
                                                (Just "Your message was not sent. Wait for the room encryption status to become ready, then try again.")
                                                t.description
                                        ]
                                        toast

                                _ ->
                                    Expect.fail "expected one toast"
                        , \m ->
                            Expect.equal
                                [ "Encrypted room is locked: wait for the room encryption status to become ready, then try again." ]
                                m.serviceLog
                        ]
                        failed
            , test "room seal failure with recovery toasts recovery" <|
                \_ ->
                    let
                        ( failed, _ ) =
                            update (RoomSealFailed { room = "#x", recoveryRequired = True, notProvisioned = False }) blank
                    in
                    case failed.toasts of
                        [ toast ] ->
                            Expect.equal
                                (Just "Your message was not sent. This room needs encryption recovery before sending.")
                                toast.description

                        _ ->
                            Expect.fail "expected one toast"
            , test "dm seal failure toasts and files an inbox notice" <|
                \_ ->
                    let
                        ( failed, _ ) =
                            update (DmSealFailed { target = "kai", keyChanged = False, schedId = Nothing }) blank
                    in
                    Expect.all
                        [ \m ->
                            case m.toasts of
                                [ toast ] ->
                                    Expect.all
                                        [ \t -> Expect.equal ToastError t.variant
                                        , \t -> Expect.equal "Encryption unavailable" t.title
                                        , \t ->
                                            Expect.equal
                                                (Just "Your message to kai was NOT sent — the encrypted DM could not be sealed. Try again.")
                                                t.description
                                        ]
                                        toast

                                _ ->
                                    Expect.fail "expected one toast"
                        , \m ->
                            case m.notifications of
                                [ note ] ->
                                    Expect.equal
                                        "Encryption unavailable — message to kai was not sent (the encrypted DM could not be sealed)."
                                        note.text

                                _ ->
                                    Expect.fail "expected one notification"
                        ]
                        failed
            ]
        , describe "blocklist undo toasts"
            [ test "IgnoreUser toasts Blocked with undo data" <|
                \_ ->
                    let
                        ( blocked, _ ) =
                            update (IgnoreUser "spammer") blank
                    in
                    case blocked.toasts of
                        [ toast ] ->
                            Expect.all
                                [ \t -> Expect.equal ToastUndo t.variant
                                , \t -> Expect.equal "Blocked spammer" t.title
                                , \t ->
                                    Expect.equal
                                        (Just "You will not see them on this device. They are not told.")
                                        t.description
                                , \t -> Expect.equal (Just (UndoUnignoreUser "spammer")) t.undo
                                ]
                                toast

                        _ ->
                            Expect.fail "expected one toast"
            , test "UnignoreUser toasts Unblocked with undo data" <|
                \_ ->
                    let
                        seeded =
                            { blank | ignoredUsers = Set.singleton "spammer" }

                        ( freed, _ ) =
                            update (UnignoreUser "spammer") seeded
                    in
                    case freed.toasts of
                        [ toast ] ->
                            Expect.all
                                [ \t -> Expect.equal ToastUndo t.variant
                                , \t -> Expect.equal "Unblocked spammer" t.title
                                , \t ->
                                    Expect.equal
                                        (Just "Messages and notifications from this name resume on this device.")
                                        t.description
                                , \t -> Expect.equal (Just (UndoIgnoreUser "spammer")) t.undo
                                ]
                                toast

                        _ ->
                            Expect.fail "expected one toast"
            , test "undo replay stays silent" <|
                \_ ->
                    let
                        ( blocked, _ ) =
                            update (IgnoreUser "spammer") blank

                        replayed =
                            case blocked.toasts of
                                [ toast ] ->
                                    update (ToastUndoFired toast.id) blocked |> Tuple.first

                                _ ->
                                    blocked
                    in
                    Expect.all
                        [ \m -> Expect.equal False (Set.member "spammer" m.ignoredUsers)
                        , \m -> Expect.equal [] m.toasts
                        ]
                        replayed
            , test "undo replay of an unblock stays silent" <|
                \_ ->
                    let
                        seeded =
                            { blank | ignoredUsers = Set.singleton "spammer" }

                        ( freed, _ ) =
                            update (UnignoreUser "spammer") seeded

                        replayed =
                            case freed.toasts of
                                [ toast ] ->
                                    update (ToastUndoFired toast.id) freed |> Tuple.first

                                _ ->
                                    freed
                    in
                    Expect.all
                        [ \m -> Expect.equal True (Set.member "spammer" m.ignoredUsers)
                        , \m -> Expect.equal [] m.toasts
                        ]
                        replayed
            ]
        ]
