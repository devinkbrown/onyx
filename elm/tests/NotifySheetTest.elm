module NotifySheetTest exposing (suite)

{-| Vectors for the Notifications sheet + per-room notify strip, mirroring
the oracle `ChannelNotifyControl.test.tsx` (level reflection, write-through,
aria-checked), `KeywordListControl` add/remove, `IgnoredUsersControl.test.tsx`
(validation guards, undo toasts), and the DND axes of
`NotificationControls.test.tsx`. Behavior runs through `App.update`; pure
helpers run directly.
-}

import App exposing (..)
import Char
import Expect
import Html
import Html.Attributes as Attr
import NotifyCenter exposing (NotifyMode(..))
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


apply : Msg -> Model -> ( Model, List Outbound )
apply msg model =
    update msg model


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


{-| A live model with `#c` joined and selected, so the room header
(and its notify strip) renders. -}
roomModel : Model
roomModel =
    { blank | caps = [ "chathistory" ] }
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> Tuple.first (update (ChannelSelect "#c") m))


testid : String -> Selector.Selector
testid name =
    Selector.attribute (Attr.attribute "data-testid" name)


suite : Test
suite =
    describe "Notifications sheet + room notify"
        [ describe "NotifyCenter vocabulary"
            [ test "stored levels map to public modes with an all default" <|
                \_ ->
                    Expect.equal
                        [ NotifyMute, NotifyMentions, NotifyAll, NotifyAll ]
                        [ NotifyCenter.modeOfLevel "none"
                        , NotifyCenter.modeOfLevel "mentions"
                        , NotifyCenter.modeOfLevel "all"
                        , NotifyCenter.modeOfLevel "bogus"
                        ]
            , test "public modes map back to stored levels" <|
                \_ ->
                    Expect.equal
                        [ "none", "mentions", "all" ]
                        [ NotifyCenter.levelOfMode NotifyMute
                        , NotifyCenter.levelOfMode NotifyMentions
                        , NotifyCenter.levelOfMode NotifyAll
                        ]
            , test "the option table mirrors the oracle order and copy" <|
                \_ ->
                    Expect.equal
                        [ ( NotifyAll, "All", "All messages" )
                        , ( NotifyMentions, "@", "Mentions only — still badges @" )
                        , ( NotifyMute, "Mute", "Mute — you will not be tapped" )
                        ]
                        (List.map (\o -> ( o.mode, o.label, o.title )) NotifyCenter.notifyOptions)
            ]
        , describe "NotifyCenter ignore validation"
            [ test "empty drafts are refused" <|
                \_ ->
                    Expect.equal
                        (Err "Enter a name to block on this device.")
                        (NotifyCenter.validateIgnoreDraft "me" "   ")
            , test "overlong drafts are refused" <|
                \_ ->
                    Expect.equal
                        (Err "Name is too long (max 128 characters).")
                        (NotifyCenter.validateIgnoreDraft "me" (String.repeat 129 "a"))
            , test "control characters are refused" <|
                \_ ->
                    Expect.equal
                        (Err "That name contains unsupported characters. Try typing it again.")
                        (NotifyCenter.validateIgnoreDraft "me" ("bob" ++ String.fromChar (Char.fromCode 7)))
            , test "blocking yourself is refused" <|
                \_ ->
                    Expect.equal
                        (Err "You cannot block yourself.")
                        (NotifyCenter.validateIgnoreDraft "me" " ME ")
            , test "valid drafts normalize to lowercase" <|
                \_ ->
                    Expect.equal
                        (Ok "bob")
                        (NotifyCenter.validateIgnoreDraft "me" " Bob ")
            ]
        , describe "NotifyCenter DND minutes"
            [ test "whole minutes parse" <|
                \_ ->
                    Expect.equal (Ok 30) (NotifyCenter.parseDndMinutes "30")
            , test "fractions floor like the slash fold" <|
                \_ ->
                    Expect.equal (Ok 1) (NotifyCenter.parseDndMinutes "1.9")
            , test "the 1–1440 window is enforced" <|
                \_ ->
                    Expect.equal
                        [ Err "Use minutes (1–1440)."
                        , Err "Use minutes (1–1440)."
                        , Err "Use minutes (1–1440)."
                        , Err "Use minutes (1–1440)."
                        , Ok 1440
                        ]
                        [ NotifyCenter.parseDndMinutes "0"
                        , NotifyCenter.parseDndMinutes "1441"
                        , NotifyCenter.parseDndMinutes "abc"
                        , NotifyCenter.parseDndMinutes ""
                        , NotifyCenter.parseDndMinutes "1440"
                        ]
            , test "until stamps mirror the fold clock math" <|
                \_ ->
                    Expect.equal 1900000 (NotifyCenter.dndUntilFor 100000 30)
            , test "status lines cover on, snoozed, and off" <|
                \_ ->
                    Expect.equal
                        [ "Do not disturb is on. Turn it off to resume alerts."
                        , "Snoozed for 30 more minutes."
                        , "Do not disturb is off."
                        ]
                        [ NotifyCenter.dndStatusLine True Nothing 0
                        , NotifyCenter.dndStatusLine False (Just 1900000) 100000
                        , NotifyCenter.dndStatusLine False Nothing 0
                        ]
            ]
        , describe "per-room notify level"
            [ test "mentions persists and fires the save outbound" <|
                \_ ->
                    let
                        ( updated, out ) =
                            apply (RoomNotifyLevel { channel = "#C", level = "mentions" }) blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal "mentions" (notifyLevel updated "#c")
                        , \_ ->
                            Expect.equal
                                [ ChannelNotifySave { entries = [ { channel = "#c", level = "mentions" } ] } ]
                                out
                        ]
                        ()
            , test "mute stores none and all prunes back to the default" <|
                \_ ->
                    let
                        ( muted, _ ) =
                            apply (RoomNotifyLevel { channel = "#c", level = "none" }) blank

                        ( cleared, clearOut ) =
                            apply (RoomNotifyLevel { channel = "#c", level = "all" }) muted
                    in
                    Expect.all
                        [ \_ -> Expect.equal "none" (notifyLevel muted "#c")
                        , \_ -> Expect.equal "all" (notifyLevel cleared "#c")
                        , \_ -> Expect.equal [ ChannelNotifySave { entries = [] } ] clearOut
                        ]
                        ()
            , test "the strip checks the stored level" <|
                \_ ->
                    let
                        ( muted, _ ) =
                            apply (RoomNotifyLevel { channel = "#c", level = "none" }) roomModel
                    in
                    Expect.all
                        [ \_ ->
                            query roomModel
                                |> Query.find [ testid "room-notify" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Notifications for #c") ]
                        , \_ ->
                            query muted
                                |> Query.find [ testid "room-notify" ]
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "All messages") ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-checked" "false") ]
                        , \_ ->
                            query muted
                                |> Query.find [ testid "room-notify" ]
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Mute — you will not be tapped") ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-checked" "true") ]
                        ]
                        ()
            ]
        , describe "keyword drafts"
            [ test "adding normalizes, clears the draft, and persists" <|
                \_ ->
                    let
                        ( updated, out ) =
                            apply NotifyKeywordAdd { blank | notifyKeywordDraft = " Elm " }
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "elm" ] updated.highlightWords
                        , \_ -> Expect.equal "" updated.notifyKeywordDraft
                        , \_ -> Expect.equal [ HighlightWordsSave { words = [ "elm" ] } ] out
                        ]
                        ()
            , test "the sheet renders the oracle keyword copy and testids" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            query { blank | notifySheetOpen = True }
                                |> Query.has
                                    [ testid "you-keywords"
                                    , testid "you-keyword-input"
                                    , testid "you-keyword-add"
                                    , testid "you-keywords-empty"
                                    ]
                        , \_ ->
                            query { blank | notifySheetOpen = True, highlightWords = [ "elm" ] }
                                |> Query.find [ testid "you-keyword-remove-elm" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Remove elm") ]
                        ]
                        ()
            ]
        , describe "ignore drafts"
            [ test "empty drafts surface the oracle error with no outbound" <|
                \_ ->
                    let
                        ( updated, out ) =
                            apply NotifyIgnoreAdd { blank | notifyIgnoreDraft = "  " }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "Enter a name to block on this device.") updated.notifyIgnoreError
                        , \_ -> Expect.equal [] out
                        ]
                        ()
            , test "self drafts are refused" <|
                \_ ->
                    let
                        ( updated, out ) =
                            apply NotifyIgnoreAdd { blank | notifyIgnoreDraft = "me" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "You cannot block yourself.") updated.notifyIgnoreError
                        , \_ -> Expect.equal [] out
                        ]
                        ()
            , test "valid drafts block with the undo toast and persist" <|
                \_ ->
                    let
                        ( updated, out ) =
                            apply NotifyIgnoreAdd { blank | notifyIgnoreDraft = "Bob" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (isBlockedDmTarget updated "bob")
                        , \_ -> Expect.equal "" updated.notifyIgnoreDraft
                        , \_ -> Expect.equal Nothing updated.notifyIgnoreError
                        , \_ -> Expect.equal [ BlocklistsSave { ignored = [ "bob" ], muted = [] } ] out
                        , \_ -> Expect.equal [ "Blocked bob" ] (List.map .title updated.toasts)
                        ]
                        ()
            , test "unignoring clears the entry and persists" <|
                \_ ->
                    let
                        ( blocked, _ ) =
                            apply NotifyIgnoreAdd { blank | notifyIgnoreDraft = "Bob" }

                        ( cleared, out ) =
                            apply (UnignoreUser "bob") blocked
                    in
                    Expect.all
                        [ \_ -> Expect.equal False (isBlockedDmTarget cleared "bob")
                        , \_ -> Expect.equal [ BlocklistsSave { ignored = [], muted = [] } ] out
                        ]
                        ()
            , test "the sheet renders the oracle ignore copy and testids" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            query { blank | notifySheetOpen = True }
                                |> Query.has
                                    [ testid "pref-ignored-users"
                                    , testid "pref-ignore-nick-input"
                                    , testid "pref-ignore-add"
                                    , testid "pref-ignored-users-empty"
                                    ]
                        , \_ ->
                            query { blank | notifySheetOpen = True, notifyIgnoreError = Just "Enter a name to block on this device." }
                                |> Query.find [ testid "pref-ignore-error" ]
                                |> Query.has [ Selector.text "Enter a name to block on this device." ]
                        ]
                        ()
            ]
        , describe "desktop and sound toggles"
            [ test "push flips with persistence" <|
                \_ ->
                    let
                        ( updated, out ) =
                            apply NotifyPushToggle blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal False updated.pushEnabled
                        , \_ -> Expect.equal [ NotifyPushSave { enabled = False } ] out
                        ]
                        ()
            , test "sound flips with persistence" <|
                \_ ->
                    let
                        ( updated, out ) =
                            apply NotifySoundToggle blank
                    in
                    Expect.all
                        [ \_ -> Expect.equal False updated.soundEnabled
                        , \_ -> Expect.equal [ NotifySoundSave { enabled = False } ] out
                        ]
                        ()
            ]
        , describe "DND sheet controls"
            [ test "toggling on persists and toggling off clears" <|
                \_ ->
                    let
                        ( on, onOut ) =
                            apply NotifyDndToggle blank

                        ( off, offOut ) =
                            apply NotifyDndToggle on
                    in
                    Expect.all
                        [ \_ -> Expect.equal True on.dndEnabled
                        , \_ -> Expect.equal [ DndSave { enabled = True, until = Nothing } ] onOut
                        , \_ -> Expect.equal False off.dndEnabled
                        , \_ -> Expect.equal Nothing off.dndUntil
                        , \_ -> Expect.equal [ DndSave { enabled = False, until = Nothing } ] offOut
                        ]
                        ()
            , test "snoozing sets the timer, clears the draft, and persists" <|
                \_ ->
                    let
                        seeded =
                            { blank | notifyDndMinutes = "30", nowMs = 100000 }

                        ( updated, out ) =
                            apply NotifyDndSnooze seeded
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just 1900000) updated.dndUntil
                        , \_ -> Expect.equal "" updated.notifyDndMinutes
                        , \_ -> Expect.equal [ DndSave { enabled = False, until = Just 1900000 } ] out
                        ]
                        ()
            , test "bad timers surface an error with no outbound" <|
                \_ ->
                    let
                        ( updated, out ) =
                            apply NotifyDndSnooze { blank | notifyDndMinutes = "0" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "Use minutes (1–1440).") updated.notifyDndError
                        , \_ -> Expect.equal [] out
                        , \_ -> Expect.equal Nothing updated.dndUntil
                        ]
                        ()
            , test "clearing resets both axes" <|
                \_ ->
                    let
                        ( on, _ ) =
                            apply NotifyDndToggle blank

                        ( cleared, out ) =
                            apply NotifyDndClear on
                    in
                    Expect.all
                        [ \_ -> Expect.equal False cleared.dndEnabled
                        , \_ -> Expect.equal Nothing cleared.dndUntil
                        , \_ -> Expect.equal [ DndSave { enabled = False, until = Nothing } ] out
                        ]
                        ()
            ]
        , describe "sheet chrome"
            [ test "the topbar opens the sheet and Escape arms close it" <|
                \_ ->
                    let
                        ( opened, _ ) =
                            apply NotifySheetOpen blank

                        ( closed, _ ) =
                            apply NotifySheetClose opened
                    in
                    Expect.all
                        [ \_ -> Expect.equal True opened.notifySheetOpen
                        , \_ -> Expect.equal False closed.notifySheetOpen
                        , \_ ->
                            query blank
                                |> Query.hasNot [ testid "notify-sheet" ]
                        , \_ ->
                            query opened
                                |> Query.find [ testid "notify-sheet" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Notifications") ]
                        , \_ ->
                            query blank
                                |> Query.find [ testid "shell-notifications" ]
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Notifications") ]
                        ]
                        ()
            , test "closing drops draft errors" <|
                \_ ->
                    let
                        ( bad, _ ) =
                            apply NotifyDndSnooze { blank | notifySheetOpen = True, notifyDndMinutes = "nope" }

                        ( closed, _ ) =
                            apply NotifySheetClose bad
                    in
                    Expect.equal Nothing closed.notifyDndError
            , test "the desktop toggle asks for permission before the grant" <|
                \_ ->
                    query { blank | notifySheetOpen = True }
                        |> Query.find [ testid "notify-desktop-toggle" ]
                        |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Enable desktop notifications") ]
            ]
        ]
