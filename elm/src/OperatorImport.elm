module OperatorImport exposing (Effect, Model, Msg(..), Phase(..), Plan(..), init, update)

{-| Typed presentation state for private, read-only setup/doctor imports.
Raw file bytes and private file handles never enter this module. -}

import Json.Decode as Decode exposing (Decoder)


type Plan
    = DoctorPlan { build : Maybe String, passed : Int, failed : Int, unknownChecks : Int, readiness : String }
    | SetupPlan { mode : String, profile : Maybe String, maxClients : Maybe Int, mediaEnabled : Maybe Bool, readiness : String, networkIrcPort : Maybe Int, networkTlsPort : Maybe Int, networkTlsEnabled : Maybe Bool, mediaAssessmentEnabled : Maybe String }


type Phase
    = Empty
    | Reading
    | Ready Plan
    | Invalid
    | UnsupportedSchema
    | TooLarge
    | Unavailable
    | StaleOwner


type alias Model =
    { phase : Phase
    , previewRef : Maybe String
    }


type Msg
    = BeginImport
    | PreviewResult Decode.Value
    | Dismiss


type alias Effect = { kind : String, previewRef : Maybe String }


init : Model
init =
    { phase = Empty, previewRef = Nothing }


update : Msg -> Model -> ( Model, Maybe Effect )
update msg model =
    case msg of
        BeginImport ->
            ( { model | phase = Reading, previewRef = Nothing }, Just { kind = "select-private-file", previewRef = Nothing } )

        PreviewResult value ->
            case Decode.decodeValue resultDecoder value of
                Ok ( ref, plan ) ->
                    ( { phase = Ready plan, previewRef = Just ref }, Nothing )

                Err _ ->
                    ( { phase = Invalid, previewRef = Nothing }, Nothing )

        Dismiss ->
            ( init, model.previewRef |> Maybe.map (\ref -> { kind = "dismiss", previewRef = Just ref }) )


resultDecoder : Decoder ( String, Plan )
resultDecoder =
    Decode.map2 Tuple.pair
        (Decode.field "previewRef" Decode.string)
        (Decode.field "plan" planDecoder)


planDecoder : Decoder Plan
planDecoder =
    Decode.field "kind" Decode.string
        |> Decode.andThen
            (\kind ->
                if kind == "doctor-v1" then
                    Decode.map4 (\build passed failed unknown -> DoctorPlan { build = build, passed = passed, failed = failed, unknownChecks = unknown, readiness = "unknown" })
                        (Decode.field "exporterBuild" (Decode.nullable Decode.string))
                        (Decode.at [ "diagnostics", "passed" ] Decode.int)
                        (Decode.at [ "diagnostics", "failed" ] Decode.int)
                        (Decode.field "checks" (Decode.list checkDecoder) |> Decode.map (List.filter (\known -> not known) >> List.length))

                else if kind == "setup-v4" then
                    Decode.map5 (\mode profile ( clients, media ) ( ircPort, tlsPort, tlsEnabled ) mediaAssessment -> SetupPlan { mode = mode, profile = profile, maxClients = clients, mediaEnabled = media, readiness = "unknown", networkIrcPort = ircPort, networkTlsPort = tlsPort, networkTlsEnabled = tlsEnabled, mediaAssessmentEnabled = mediaAssessment })
                        (Decode.field "mode" Decode.string)
                        (Decode.field "profile" (Decode.nullable Decode.string))
                        effectiveProfileDecoder
                        networkAssessmentDecoder
                        (Decode.oneOf [ Decode.at [ "media", "enabled" ] Decode.string |> Decode.map Just, Decode.succeed Nothing ])

                else
                    Decode.fail "unknown plan"
            )


checkDecoder : Decoder Bool
checkDecoder =
    Decode.field "id" Decode.string
        |> Decode.map (\id -> id /= "unknown-check")


effectiveProfileDecoder : Decoder ( Maybe Int, Maybe Bool )
effectiveProfileDecoder =
    Decode.field "effectiveProfile" (Decode.nullable (Decode.map2 Tuple.pair (Decode.field "maxClients" Decode.int) (Decode.field "mediaEnabled" Decode.bool)))
        |> Decode.map (Maybe.map (Tuple.mapFirst Just >> Tuple.mapSecond Just) >> Maybe.withDefault ( Nothing, Nothing ))


networkAssessmentDecoder : Decoder ( Maybe Int, Maybe Int, Maybe Bool )
networkAssessmentDecoder =
    Decode.oneOf
        [ Decode.field "network" (Decode.nullable (Decode.map3 (\irc tls enabled -> ( Just irc, Just tls, Just enabled )) (Decode.field "ircPort" Decode.int) (Decode.field "tlsPort" Decode.int) (Decode.field "tlsEnabled" Decode.bool)))
            |> Decode.map (Maybe.withDefault ( Nothing, Nothing, Nothing ))
        , Decode.succeed ( Nothing, Nothing, Nothing )
        ]
