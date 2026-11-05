module RoadmapTranscriptTest exposing (suite)

{-| The checked-in roadmap transcript catalog is generated verbatim into
`RoadmapFixtures.elm`. These generic cases decode that catalog and run each
timestamped input through the pure App fold; expected outputs are not copied
into this test module.
-}

import App exposing (Model, Outbound(..), ReclaimPhase(..), blank)
import Expect
import Json.Decode as Decode exposing (Decoder)
import Session
import Test exposing (Test, describe, test)
import Wire
import RoadmapFixtures


type alias Catalog =
    { scenarios : List Scenario }


type alias Scenario =
    { id : String
    , initial : Initial
    , steps : List Step
    , expect : Expected
    }


type alias Initial =
    { nowMs : Float
    , connection : String
    , reclaim : Maybe ReclaimSeed
    }


type alias ReclaimSeed =
    { phase : String
    , kind : String
    }


type Step
    = Incoming Float String
    | ConfirmReclaim Float


type alias Expected =
    { caps : List String
    , outboundLines : List String
    , reclaimPhase : String
    , notificationTexts : List String
    }


type alias Folded =
    { model : Model
    , outboundLines : List String
    }


reclaimSeedDecoder : Decoder ReclaimSeed
reclaimSeedDecoder =
    Decode.map2 ReclaimSeed
        (Decode.field "phase" Decode.string)
        (Decode.field "kind" Decode.string)


initialDecoder : Decoder Initial
initialDecoder =
    Decode.map3 Initial
        (Decode.field "nowMs" Decode.float)
        (Decode.field "connection" Decode.string)
        (Decode.maybe (Decode.field "reclaim" reclaimSeedDecoder))


stepWithTimeDecoder : Decoder Step
stepWithTimeDecoder =
    Decode.field "event" Decode.string
        |> Decode.andThen
            (\event ->
                if event == "reclaim-confirm" then
                    Decode.map ConfirmReclaim (Decode.field "atMs" Decode.float)

                else
                    Decode.fail ("unknown transcript event: " ++ event)
            )


scenarioStepDecoder : Decoder Step
scenarioStepDecoder =
    Decode.oneOf
        [ Decode.map2 Incoming (Decode.field "atMs" Decode.float) (Decode.field "line" Decode.string)
        , stepWithTimeDecoder
        ]


expectedDecoder : Decoder Expected
expectedDecoder =
    Decode.map4 Expected
        (Decode.field "caps" (Decode.list Decode.string))
        (Decode.field "outboundLines" (Decode.list Decode.string))
        (Decode.field "reclaimPhase" Decode.string)
        (Decode.oneOf [ Decode.field "notificationTexts" (Decode.list Decode.string), Decode.succeed [] ])


scenarioDecoder : Decoder Scenario
scenarioDecoder =
    Decode.map4 Scenario
        (Decode.field "id" Decode.string)
        (Decode.field "initial" initialDecoder)
        (Decode.field "steps" (Decode.list scenarioStepDecoder))
        (Decode.field "expect" expectedDecoder)


catalogDecoder : Decoder Catalog
catalogDecoder =
    Decode.map Catalog (Decode.field "scenarios" (Decode.list scenarioDecoder))


initialModel : Initial -> Model
initialModel initial =
    let
        connection =
            case initial.connection of
                "live" ->
                    App.Live

                "registering" ->
                    App.Registering

                _ ->
                    App.Offline

        seeded =
            { blank
                | nowMs = initial.nowMs
                , connection = connection
                , capNegotiating = initial.connection == "registering"
            }
    in
    case initial.reclaim of
        Just reclaim ->
            if reclaim.phase == "restoring" && reclaim.kind == "local" then
                { seeded | sessionReclaim = Just { phase = Restoring, kind = Just Session.LocalBearer, credentialKind = Just Session.LocalLogical, credentialRef = Nothing, outcome = Session.ResumePending } }

            else
                seeded

        Nothing ->
            seeded


outboundText : List Outbound -> List String
outboundText outbound =
    List.filterMap
        (\effect ->
            case effect of
                SendLine value ->
                    Just value

                _ ->
                    Nothing
        )
        outbound


foldStep : Step -> Folded -> Folded
foldStep step folded =
    case step of
        Incoming atMs raw ->
            let
                before =
                    folded.model

                ( model, outbound ) =
                    App.foldLine { before | nowMs = atMs } (Wire.parseIrcMessage raw)
            in
            { model = model
            , outboundLines = folded.outboundLines ++ outboundText outbound
            }

        ConfirmReclaim atMs ->
            let
                before =
                    folded.model

                ( model, outbound ) =
                    App.update (App.ReclaimTimerFired { stage = "confirm" }) { before | nowMs = atMs }
            in
            { model = model
            , outboundLines = folded.outboundLines ++ outboundText outbound
            }


phaseName : Model -> String
phaseName model =
    case model.sessionReclaim of
        Nothing ->
            "none"

        Just notice ->
            case notice.phase of
                Restoring ->
                    "restoring"

                Reclaimed ->
                    "reclaimed"

                App.ReclaimFailed ->
                    "failed"

                SignInAgain ->
                    "sign-in-again"


scenarioTest : Scenario -> Test
scenarioTest scenario =
    test scenario.id <|
        \_ ->
            let
                folded =
                    List.foldl foldStep
                        { model = initialModel scenario.initial, outboundLines = [] }
                        scenario.steps
            in
            Expect.all
                [ \_ -> Expect.equal scenario.expect.caps folded.model.caps
                , \_ -> Expect.equal scenario.expect.outboundLines folded.outboundLines
                , \_ -> Expect.equal scenario.expect.reclaimPhase (phaseName folded.model)
                , \_ -> Expect.equal scenario.expect.notificationTexts (List.map .text folded.model.notifications)
                , \_ ->
                    Expect.equal
                        (List.foldl (\step _ -> stepTime step) scenario.initial.nowMs scenario.steps)
                        folded.model.nowMs
                ]
                ()


stepTime : Step -> Float
stepTime step =
    case step of
        Incoming atMs _ ->
            atMs

        ConfirmReclaim atMs ->
            atMs


suite : Test
suite =
    case Decode.decodeString catalogDecoder RoadmapFixtures.catalogJson of
        Ok catalog ->
            describe "source-bound roadmap transcript fixtures" (List.map scenarioTest catalog.scenarios)

        Err error ->
            test "roadmap catalog decodes" (\_ -> Expect.fail (Decode.errorToString error))
