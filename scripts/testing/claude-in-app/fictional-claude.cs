using System;
using System.IO;
using System.Threading;

// This executable has no model, credential, or network implementation.
public class FictionalClaude {
    public static int Main(string[] args) {
        if (Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY") != null ||
            Environment.GetEnvironmentVariable("CLAUDE_CODE_OAUTH_TOKEN") != null ||
            Environment.GetEnvironmentVariable("NODE_OPTIONS") != null) return 7;
        if (args.Length == 1 && args[0] == "--version") {
            Console.WriteLine("2.1.300 (FICTIONAL TEST RUNTIME)");
            return 0;
        }
        if (args.Length == 2 && args[0] == "auth" && args[1] == "status") {
            Console.WriteLine("{\"loggedIn\":true,\"authMethod\":\"claude.ai\"}");
            return 0;
        }
        string model = "";
        for (int i = 0; i + 1 < args.Length; i++)
            if (args[i] == "--model") model = args[i + 1];
        string input = Console.In.ReadToEnd();
        if (input.IndexOf("fixed fictional transport fixture") < 0 ||
            Path.GetFileName(Environment.CurrentDirectory).IndexOf("readystate-claude-") != 0) return 8;
        string log = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "native-calls.log");
        File.AppendAllText(log, "started:" + model + Environment.NewLine);
        if (model == "haiku") Thread.Sleep(15000);
        if (model == "opus") {
            Console.WriteLine("{\"is_error\":true,\"result\":\"Fictional usage limit reached\"}");
            return 1;
        }
        if (model != "sonnet" && model != "haiku") return 9;
        string json = input.Substring(input.LastIndexOf('\n') + 1);
        File.AppendAllText(log, "completed:" + model + Environment.NewLine);
        Console.WriteLine("{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":" +
            json + ",\"modelUsage\":{\"fictional-sonnet-evidence\":{}}}");
        return 0;
    }
}
