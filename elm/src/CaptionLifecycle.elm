module CaptionLifecycle exposing (Effect(..), Model, Msg(..), Mode(..), State(..), init, update)


type Mode
    = LocalOnly
    | BrowserSpeechService


type State
    = Idle
    | PreparingLanguage
    | LanguageReady
    | Listening
    | Unavailable String
    | Failed String


type alias Model =
    { ownerRef : String
    , callRef : Maybe String
    , language : Maybe String
    , mode : Maybe Mode
    , state : State
    , interimText : Maybe String
    }


type Msg
    = PrepareLocal String String
    | StartRequested String String Mode Bool
    | StopRequested String
    | LanguagePrepared String Bool String
    | CaptionStatus String State
    | InterimCaption String String
    | MembershipOrConsentLost
    | OwnerRetired String


type Effect
    = PrepareLanguage String String
    | StartCaptions String String Mode Bool
    | StopCaptions String
    | NoEffect


init : String -> Model
init ownerRef =
    { ownerRef = ownerRef, callRef = Nothing, language = Nothing, mode = Nothing, state = Idle, interimText = Nothing }


update : Msg -> Model -> ( Model, Effect )
update msg model =
    case msg of
        PrepareLocal callRef language ->
            if String.isEmpty callRef || String.isEmpty language then
                ( { model | state = Failed "invalid-language-intent" }, NoEffect )

            else
                ( { model | callRef = Just callRef, language = Just language, state = PreparingLanguage }, PrepareLanguage callRef language )

        StartRequested callRef language mode browserServiceConsent ->
            if String.isEmpty callRef || String.isEmpty language || (mode == BrowserSpeechService && not browserServiceConsent) then
                ( { model | state = Unavailable "explicit-consent-required" }, NoEffect )

            else
                ( { model | callRef = Just callRef, language = Just language, mode = Just mode, state = PreparingLanguage, interimText = Nothing }
                , StartCaptions callRef language mode browserServiceConsent
                )

        StopRequested callRef ->
            if model.callRef == Just callRef then
                ( { model | state = Idle, interimText = Nothing }, StopCaptions callRef )

            else
                ( model, NoEffect )

        LanguagePrepared callRef ready reason ->
            if model.callRef == Just callRef then
                ( { model | state = if ready then LanguageReady else Unavailable reason }, NoEffect )

            else
                ( model, NoEffect )

        CaptionStatus callRef state ->
            if model.callRef == Just callRef then
                ( { model | state = state }, NoEffect )

            else
                ( model, NoEffect )

        InterimCaption callRef text ->
            if model.callRef == Just callRef then
                ( { model | interimText = Just text }, NoEffect )

            else
                ( model, NoEffect )

        MembershipOrConsentLost ->
            ( { model | state = Idle, interimText = Nothing }, model.callRef |> Maybe.map StopCaptions |> Maybe.withDefault NoEffect )

        OwnerRetired ownerRef ->
            if ownerRef == model.ownerRef then
                ( { model | callRef = Nothing, state = Idle, interimText = Nothing }, model.callRef |> Maybe.map StopCaptions |> Maybe.withDefault NoEffect )

            else
                ( model, NoEffect )
