module MediaInterop exposing (Effect(..), Model, Msg(..), Observation, State(..), init, update)

{-| State for a deliberately separate native WebRTC loopback experiment. This
does not select or alter the ordinary Cadence call transport.
-}


type State
    = Idle
    | Preparing
    | Completed
    | Unsupported String
    | Failed String
    | Cancelled


type alias Observation =
    { state : State
    , audioCodec : Maybe String
    , videoCodec : Maybe String
    , iceState : String
    , dtlsState : String
    , connectionState : String
    , transportClass : String
    , inboundBytes : Maybe Int
    , inboundPackets : Maybe Int
    , decodedFrames : Maybe Int
    , durationMs : Float
    }


type alias Model =
    { ownerRef : String
    , requestId : Maybe String
    , state : State
    , observation : Maybe Observation
    }


type Msg
    = StartRequested String String String
    | StopRequested String
    | ObservationReceived String Observation
    | OwnerRetired String


type Effect
    = RunLocalExperiment String String String
    | StopExperiment String
    | NoEffect


init : String -> Model
init ownerRef =
    { ownerRef = ownerRef, requestId = Nothing, state = Idle, observation = Nothing }


update : Msg -> Model -> ( Model, Effect )
update msg model =
    case msg of
        StartRequested requestId captureRef kind ->
            if String.isEmpty requestId || String.isEmpty captureRef || (kind /= "audio" && kind /= "audio-video") then
                ( { model | state = Failed "invalid-experiment-intent" }, NoEffect )

            else
                ( { model | requestId = Just requestId, state = Preparing, observation = Nothing }
                , RunLocalExperiment requestId captureRef kind
                )

        StopRequested requestId ->
            if model.requestId == Just requestId then
                ( { model | state = Cancelled }, StopExperiment requestId )

            else
                ( model, NoEffect )

        ObservationReceived requestId observation ->
            if model.requestId == Just requestId then
                ( { model | state = observation.state, observation = Just observation }, NoEffect )

            else
                ( model, NoEffect )

        OwnerRetired ownerRef ->
            if ownerRef == model.ownerRef then
                ( { model | requestId = Nothing, state = Cancelled, observation = Nothing }, model.requestId |> Maybe.map StopExperiment |> Maybe.withDefault NoEffect )

            else
                ( model, NoEffect )
