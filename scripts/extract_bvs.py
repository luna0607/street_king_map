import re
import sys

text = sys.stdin.read()
bvs = re.findall(r'BV[a-zA-Z0-9]{10}', text)
print(json.dumps(list(set(bvs))))
