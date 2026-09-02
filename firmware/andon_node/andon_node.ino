#include <SPI.h>
#include <LoRa.h>

// ============================================================
// ESP32 + SX1278/SX1276 ANDON NODE
// Satu node mewakili satu line.
// ============================================================
#define LORA_SCK  18
#define LORA_MISO 19
#define LORA_MOSI 23
#define LORA_SS    5
#define LORA_RST  14
#define LORA_DIO0 26

#define LORA_FREQ 923E6

// -------- IDENTITAS NODE --------
#define NODE_ID "NODE01"
#define DEPARTMENT_ID 1   // 1 = Sleeve pada database contoh

// -------- INPUT BUTTON --------
#define BTN_MACHINE   25
#define BTN_MATERIAL  33
#define BTN_QUALITY   32
#define BTN_RESET     27

// -------- OUTPUT ANDON --------
#define LAMP_RED      4
#define LAMP_YELLOW  13
#define LAMP_BLUE     16
#define LAMP_GREEN    17
#define BUZZER        21

bool lastMachine = HIGH;
bool lastMaterial = HIGH;
bool lastQuality = HIGH;
bool lastReset = HIGH;

unsigned long lastDebounce = 0;
const unsigned long DEBOUNCE_MS = 80;

void sendEvent(const char* command) {
  LoRa.beginPacket();
  LoRa.print("EVENT|");
  LoRa.print(NODE_ID);
  LoRa.print("|");
  LoRa.print(DEPARTMENT_ID);
  LoRa.print("|");
  LoRa.print(command);
  LoRa.endPacket();
}

void applyOutput(const String& command) {
  digitalWrite(LAMP_RED, LOW);
  digitalWrite(LAMP_YELLOW, LOW);
  digitalWrite(LAMP_BLUE, LOW);
  digitalWrite(LAMP_GREEN, LOW);
  digitalWrite(BUZZER, LOW);

  if (command == "MACHINE") {
    digitalWrite(LAMP_RED, HIGH);
    digitalWrite(BUZZER, HIGH);
  }
  else if (command == "MATERIAL") {
    digitalWrite(LAMP_YELLOW, HIGH);
    digitalWrite(BUZZER, HIGH);
  }
  else if (command == "QUALITY") {
    digitalWrite(LAMP_BLUE, HIGH);
    digitalWrite(BUZZER, HIGH);
  }
  else if (command == "RESET") {
    digitalWrite(LAMP_GREEN, HIGH);
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(BTN_MACHINE, INPUT_PULLUP);
  pinMode(BTN_MATERIAL, INPUT_PULLUP);
  pinMode(BTN_QUALITY, INPUT_PULLUP);
  pinMode(BTN_RESET, INPUT_PULLUP);

  pinMode(LAMP_RED, OUTPUT);
  pinMode(LAMP_YELLOW, OUTPUT);
  pinMode(LAMP_BLUE, OUTPUT);
  pinMode(LAMP_GREEN, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  applyOutput("RESET");

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("NODE_ERROR|LoRa gagal start");
    while (true) delay(1000);
  }

  LoRa.setTxPower(17);
  Serial.println("NODE_READY");
}

void loop() {
  // ---------------- BUTTON -> LORA ----------------
  bool nowMachine = digitalRead(BTN_MACHINE);
  bool nowMaterial = digitalRead(BTN_MATERIAL);
  bool nowQuality = digitalRead(BTN_QUALITY);
  bool nowReset = digitalRead(BTN_RESET);

  if (millis() - lastDebounce > DEBOUNCE_MS) {
    if (lastMachine == HIGH && nowMachine == LOW) {
      applyOutput("MACHINE");
      sendEvent("MACHINE");
    }
    if (lastMaterial == HIGH && nowMaterial == LOW) {
      applyOutput("MATERIAL");
      sendEvent("MATERIAL");
    }
    if (lastQuality == HIGH && nowQuality == LOW) {
      applyOutput("QUALITY");
      sendEvent("QUALITY");
    }
    if (lastReset == HIGH && nowReset == LOW) {
      applyOutput("RESET");
      sendEvent("RESET");
    }
    lastDebounce = millis();
  }

  lastMachine = nowMachine;
  lastMaterial = nowMaterial;
  lastQuality = nowQuality;
  lastReset = nowReset;

  // ---------------- LORA -> OUTPUT ----------------
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String msg = "";
    while (LoRa.available()) msg += (char)LoRa.read();

    // Gateway mengirim: CMD|1|MACHINE / MATERIAL / QUALITY / RESET
    if (msg.startsWith("CMD|")) {
      int p1 = msg.indexOf('|');
      int p2 = msg.indexOf('|', p1 + 1);
      if (p1 >= 0 && p2 >= 0) {
        int id = msg.substring(p1 + 1, p2).toInt();
        String command = msg.substring(p2 + 1);
        command.trim();

        if (id == DEPARTMENT_ID) {
          applyOutput(command);
          sendEvent(command.c_str()); // kirim status balik sebagai ACK
        }
      }
    }
  }
}
