module FirstHourTest exposing (suite)

import Expect
import FirstHour exposing (Landing(..))
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "first hour"
        [ test "records a trimmed room and drops a blank channel" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal
                            { landing = Room, channel = Just "#lounge", guest = True }
                            (FirstHour.record { landing = Room, channel = Just "  #lounge  ", guest = True })
                    , \_ ->
                        Expect.equal
                            { landing = Home, channel = Nothing, guest = True }
                            (FirstHour.record { landing = Home, channel = Just "   ", guest = True })
                    ]
                    ()
        , test "the home welcome is only the empty connected home" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal True
                            (FirstHour.shouldShowHomeWelcome { connected = True, hasRooms = False, directoryCount = 0, recentCount = 0 })
                    , \_ ->
                        Expect.equal False
                            (FirstHour.shouldShowHomeWelcome { connected = True, hasRooms = True, directoryCount = 0, recentCount = 0 })
                    , \_ ->
                        Expect.equal False
                            (FirstHour.shouldShowHomeWelcome { connected = False, hasRooms = False, directoryCount = 0, recentCount = 0 })
                    ]
                    ()
        , test "a guest sees one tip for the landing they chose" <|
            \_ ->
                let
                    home =
                        FirstHour.record { landing = Home, channel = Nothing, guest = True }

                    room =
                        FirstHour.record { landing = Room, channel = Just "#root", guest = True }
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "home-next") (FirstHour.coachTip False (Just home) Home |> Maybe.map .id)
                    , \_ -> Expect.equal Nothing (FirstHour.coachTip False (Just home) Room)
                    , \_ -> Expect.equal (Just "Say hi — type below and press Enter.") (FirstHour.composerHint False (Just room))
                    , \_ -> Expect.equal Nothing (FirstHour.coachTip True (Just home) Home)
                    ]
                    ()
        , test "a signed-in handoff does not coach or hide the claim" <|
            \_ ->
                let
                    handoff =
                        FirstHour.record { landing = Home, channel = Nothing, guest = False }
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (FirstHour.coachTip False (Just handoff) Home)
                    , \_ -> Expect.equal False (FirstHour.shouldSuppressGuestClaim False (Just handoff))
                    ]
                    ()
        , test "a guest handoff hides the claim until the tip is finished" <|
            \_ ->
                let
                    handoff =
                        FirstHour.record { landing = Room, channel = Just "#general", guest = True }
                in
                Expect.all
                    [ \_ -> Expect.equal True (FirstHour.shouldSuppressGuestClaim False (Just handoff))
                    , \_ -> Expect.equal False (FirstHour.shouldSuppressGuestClaim True (Just handoff))
                    ]
                    ()
        , test "composer focus happens once for the joined room" <|
            \_ ->
                let
                    handoff =
                        FirstHour.record { landing = Room, channel = Just "#General", guest = True }
                in
                Expect.all
                    [ \_ ->
                        Expect.equal True
                            (FirstHour.shouldFocusComposer { focused = False, handoff = Just handoff, activeChannel = Just "#general" })
                    , \_ ->
                        Expect.equal False
                            (FirstHour.shouldFocusComposer { focused = True, handoff = Just handoff, activeChannel = Just "#general" })
                    , \_ ->
                        Expect.equal False
                            (FirstHour.shouldFocusComposer { focused = False, handoff = Just handoff, activeChannel = Just "#other" })
                    ]
                    ()
        , test "the invite link encodes the room" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "/invite/" (FirstHour.inviteFriendsHref Nothing)
                    , \_ -> Expect.equal "/invite/?join=%23root" (FirstHour.inviteFriendsHref (Just "#root"))
                    ]
                    ()
        ]
